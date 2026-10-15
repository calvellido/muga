import { enableNav, FsapiClient, readNavInfo } from "@muga/fsapi-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type RadioSimulator, startSimulator } from "../src/index.ts";

let sim: RadioSimulator | undefined;

afterEach(async () => {
  await sim?.close();
  sim = undefined;
});

describe("simulator behaviors", () => {
  it("plays a preset when it is selected", async () => {
    sim = await startSimulator();
    const client = new FsapiClient({ host: sim.host });
    await client.set("netRemote.nav.action.selectPreset", 1);
    await expect(client.get("netRemote.play.info.name")).resolves.toBe("Frontera FM");
    await expect(client.get("netRemote.nav.preset.currentPreset")).resolves.toBe(1);
  });

  it("reflects source changes and play control", async () => {
    sim = await startSimulator();
    const client = new FsapiClient({ host: sim.host });
    await client.set("netRemote.sys.mode", 3);
    await expect(client.get("netRemote.play.info.name")).resolves.toBe("DAB");
    await client.set("netRemote.play.control", "PAUSE");
    await expect(client.get("netRemote.play.status")).resolves.toBe("PAUSED");
    await client.set("netRemote.sys.power", "OFF");
    await expect(client.get("netRemote.play.status")).resolves.toBe("IDLE");
  });

  it("stores and deletes presets", async () => {
    sim = await startSimulator();
    const client = new FsapiClient({ host: sim.host });
    await client.set("netRemote.play.addPreset", 2);
    expect(sim.list("netRemote.nav.presets").find((p) => p.key === 2)?.name).toBe("Radio Muga");
    await client.set("netRemote.nav.preset.delete", 0);
    expect(sim.list("netRemote.nav.presets").find((p) => p.key === 0)?.name).toBe("");
  });

  it("tunes FM and seeks between stations", async () => {
    sim = await startSimulator();
    const client = new FsapiClient({ host: sim.host });
    await client.set("netRemote.sys.mode", 4); // FM, tuned to 93.2 MHz
    await expect(client.get("netRemote.play.info.name")).resolves.toBe("Frontera");
    await client.set("netRemote.play.frequency", 95_000);
    await expect(client.get("netRemote.play.info.name")).resolves.toBe("95.00MHz");
    await client.set("netRemote.play.control", "NEXT");
    await expect(client.get("netRemote.play.frequency")).resolves.toBe(99_100);
    await expect(client.get("netRemote.play.info.name")).resolves.toBe("Harbour");
    await client.set("netRemote.play.control", "PREVIOUS");
    await expect(client.get("netRemote.play.frequency")).resolves.toBe(93_200);
    await expect(client.set("netRemote.play.frequency", 120_000)).rejects.toMatchObject({
      fsStatus: "FS_FAIL",
    });
  });

  it("scans DAB step by step, and a prune keeps only the stations found", async () => {
    sim = await startSimulator({ dabScanStepMs: 2 });
    const client = new FsapiClient({ host: sim.host });
    await client.set("netRemote.sys.mode", 3); // DAB, 16 stations in the menu
    await client.set("netRemote.nav.action.dabScan", "SCAN");
    await expect(client.get("netRemote.nav.action.dabScan")).resolves.toBe("SCAN");
    await vi.waitUntil(async () => (await client.get("netRemote.nav.action.dabScan")) === "IDLE");
    await expect(client.get("netRemote.nav.dabScanUpdate")).resolves.toBe(12);

    await client.set("netRemote.nav.action.dabPrune", "PRUNE");
    await expect(client.get("netRemote.nav.action.dabPrune")).resolves.toBe("IDLE");
    await enableNav(client, { pollMs: 2 });
    await expect(readNavInfo(client)).resolves.toMatchObject({ numItems: 12 });
  });

  it("refuses a DAB scan on other sources", async () => {
    sim = await startSimulator();
    const client = new FsapiClient({ host: sim.host });
    await expect(client.set("netRemote.nav.action.dabScan", "SCAN")).rejects.toMatchObject({
      fsStatus: "FS_FAIL",
    });
    await expect(client.get("netRemote.nav.action.dabScan")).resolves.toBe("IDLE");
  });

  it("gives stations made-up logos it serves itself", async () => {
    sim = await startSimulator();
    const client = new FsapiClient({ host: sim.host });
    await client.set("netRemote.nav.action.selectPreset", 1);
    const uri = await client.get("netRemote.play.info.graphicUri");
    expect(uri).toBe(`${sim.url}/artwork.svg?name=Frontera%20FM`);
    const res = await fetch(uri);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    expect(await res.text()).toContain(">FF</text>");
  });

  it("can be turned off", async () => {
    sim = await startSimulator({ behaviors: false });
    const client = new FsapiClient({ host: sim.host });
    await client.set("netRemote.play.control", "PAUSE");
    await expect(client.get("netRemote.play.status")).resolves.toBe("PLAYING");
  });
});
