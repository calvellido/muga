import { type RadioSimulator, startSimulator } from "@muga/fsapi-sim";
import { afterEach, describe, expect, it } from "vitest";
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
  it("probes, saves and selects a radio, persisting across instances", async () => {
    const radio = await sim();
    const storage = new MemoryStorage();
    const first = registry(storage);
    const config = await first.add(radio.host);
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

  it("updates instead of duplicating when the same radio is added again", async () => {
    const radio = await sim({ pin: "9999" });
    const r = registry();
    await expect(r.add(radio.host, "1234")).rejects.toMatchObject({ kind: "pin" });
    await r.add(radio.host, "9999");
    await r.add(radio.host, "9999");
    expect(r.getSnapshot().radios).toHaveLength(1);
  });

  it("rejects hosts where no radio answers", async () => {
    await expect(registry().probe("127.0.0.1:1")).rejects.toMatchObject({ kind: "network" });
  });

  it("selects and removes radios", async () => {
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
    await r.add(a.host);
    await r.add(b.host);
    expect(r.getSnapshot().activeId).toBe("B");
    r.select("A");
    expect(r.getSnapshot().activeId).toBe("A");
    r.remove("A");
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
    await r.add(radio.host);
    expect(r.getSnapshot().radios).toHaveLength(1);
    expect(registry(undefined).getSnapshot().radios).toEqual([]);
  });
});
