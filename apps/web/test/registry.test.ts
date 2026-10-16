import { type RadioSimulator, startSimulatedHome, startSimulator } from "@muga/fsapi-sim";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RadioRegistry, type StorageLike } from "../src/radio/registry.ts";

class MemoryStorage implements StorageLike {
  readonly data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

const sims: RadioSimulator[] = [];
const registries: RadioRegistry[] = [];

async function sim(options: Parameters<typeof startSimulator>[0] = {}) {
  const s = await startSimulator(options);
  sims.push(s);
  return s;
}

function registry(storage: StorageLike | undefined = new MemoryStorage()) {
  const r = new RadioRegistry({
    storage,
    controller: { activeIntervalMs: 60_000, backgroundIntervalMs: 60_000 },
  });
  registries.push(r);
  return r;
}

afterEach(async () => {
  for (const r of registries.splice(0)) r.stop();
  await Promise.all(sims.splice(0).map((s) => s.close()));
});

describe("RadioRegistry", () => {
  it("connects a radio (probes, saves and selects it), persisting across instances", async () => {
    const radio = await sim();
    const storage = new MemoryStorage();
    const first = registry(storage);
    const config = await first.connect(radio.host);
    expect(config).toEqual({
      id: "002261000000",
      host: radio.host,
      pin: "1234",
      name: "Muga Simulator",
    });
    expect(first.getSnapshot()).toEqual({ radios: [config], activeId: config.id });

    const second = registry(storage);
    expect(second.getSnapshot()).toEqual({ radios: [config], activeId: config.id });
  });

  it("updates instead of duplicating when the same radio is connected again", async () => {
    const radio = await sim({ pin: "9999" });
    const r = registry();
    await expect(r.connect(radio.host, "1234")).rejects.toMatchObject({ kind: "pin" });
    await r.connect(radio.host, "9999");
    await r.connect(radio.host, "9999");
    expect(r.getSnapshot().radios).toHaveLength(1);
  });

  it("rejects hosts where no radio answers", async () => {
    await expect(registry().probe("127.0.0.1:1")).rejects.toMatchObject({ kind: "network" });
  });

  it("selects and forgets radios", async () => {
    const a = await sim({
      profile: {
        values: { "netRemote.sys.info.radioId": "A", "netRemote.sys.info.friendlyName": "Alpha" },
      },
    });
    const b = await sim({
      profile: {
        values: { "netRemote.sys.info.radioId": "B", "netRemote.sys.info.friendlyName": "Beta" },
      },
    });
    const r = registry();
    await r.connect(a.host);
    await r.connect(b.host);
    expect(r.getSnapshot().activeId).toBe("B");
    r.select("A");
    expect(r.getSnapshot().activeId).toBe("A");
    r.forget("A");
    expect(r.getSnapshot()).toMatchObject({ activeId: "B", radios: [{ id: "B", name: "Beta" }] });
  });

  it("keeps working when storage is unavailable or throws", async () => {
    const radio = await sim();
    const broken: StorageLike = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    const r = registry(broken);
    await r.connect(radio.host);
    expect(r.getSnapshot().radios).toHaveLength(1);
    expect(registry(undefined).getSnapshot().radios).toEqual([]);
  });
});

describe("while the page is hidden", () => {
  it("still reads the speaker on screen, slowly, and pauses the others", async () => {
    const home = await startSimulatedHome({ speakers: 2 });
    try {
      const [living, kitchen] = home.speakers;
      if (!living || !kitchen) throw new Error("no speakers");
      const r = new RadioRegistry({
        storage: new MemoryStorage(),
        controller: { activeIntervalMs: 20, backgroundIntervalMs: 50 },
        multiroom: { intervalMs: 60_000, settleMs: 0 },
      });
      registries.push(r);
      const away = await r.connect(living.host);
      const shown = await r.connect(kitchen.host);
      const name = (id: string) => r.controller(id)?.getSnapshot().play.name;
      await vi.waitFor(() => expect(name(away.id)).toBe(name(shown.id)));

      r.setVisible(false);
      // A poll already under way still finishes.
      await new Promise((resolve) => setTimeout(resolve, 100));
      living.set("netRemote.play.info.name", "Away station");
      kitchen.set("netRemote.play.info.name", "Shown station");
      await vi.waitFor(() => expect(name(shown.id)).toBe("Shown station"));
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(name(away.id)).not.toBe("Away station");

      r.setVisible(true);
      await vi.waitFor(() => expect(name(away.id)).toBe("Away station"));
    } finally {
      await home.close();
    }
  });
});
