import { FsapiClient } from "@muga/fsapi-core";
import { describe, expect, it } from "vitest";
import { simulatedRadio } from "./support.ts";

const setup = simulatedRadio();
const DAB = 3;

async function onDab(options: Parameters<typeof setup>[0] = {}) {
  const radio = await setup({
    ...options,
    sim: { dabScanStepMs: 5, ...options.sim },
    controller: { dabPollMs: 5, ...options.controller },
  });
  await radio.controller.setMode(DAB);
  await radio.controller.refreshNow();
  return radio;
}

const prunes = (sim: { requests: readonly { verb: string; node?: string }[] }) =>
  sim.requests.filter((r) => r.verb === "SET" && r.node === "netRemote.nav.action.dabPrune");

describe("DabScanner", () => {
  it("scans, reports progress, prunes, then reopens the station list", async () => {
    const { sim, controller } = await onDab();
    const counts = new Set<number>();
    controller.subscribe(() => counts.add(controller.getSnapshot().dabScan.found));

    expect(await controller.dab.scan()).toBe(true);
    expect(controller.getSnapshot().dabScan).toEqual({ status: "done", found: 12 });
    expect(counts.size).toBeGreaterThan(2);
    expect(prunes(sim)).toHaveLength(1);

    expect(controller.getSnapshot().browse.status).toBe("idle");
    await controller.browse.open();
    expect(controller.getSnapshot().browse.items).toHaveLength(12);
  });

  it("doesn't prune a cancelled scan", async () => {
    const { sim, controller } = await onDab({ sim: { dabScanStepMs: 40 } });
    const scanning = controller.dab.scan();
    await new Promise((resolve) => setTimeout(resolve, 60));
    await controller.dab.cancel();
    expect(await scanning).toBe(false);
    expect(controller.getSnapshot().dabScan.status).toBe("cancelled");
    expect(prunes(sim)).toHaveLength(0);
  });

  it("finishes with no stations where there's no DAB coverage", async () => {
    const { controller } = await onDab({
      sim: { profile: { modes: { DAB: { menu: [], scan: [] } } } },
    });
    await controller.browse.open();
    expect(controller.getSnapshot().browse.status).toBe("unavailable");

    expect(await controller.dab.scan()).toBe(true);
    expect(controller.getSnapshot().dabScan).toEqual({ status: "done", found: 0 });
    await controller.browse.open();
    expect(controller.getSnapshot().browse.status).toBe("unavailable");
  });

  it("follows a scan that was already running", async () => {
    const { sim, controller } = await onDab({ sim: { dabScanStepMs: 20 } });
    // Started elsewhere (e.g. the radio's own menu).
    await new FsapiClient({ host: sim.host }).set("netRemote.nav.action.dabScan", "SCAN");
    await controller.dab.check();
    expect(controller.dab.scanning).toBe(true);
    await expect
      .poll(() => controller.getSnapshot().dabScan.status, { timeout: 2_000 })
      .toBe("done");
  });
});
