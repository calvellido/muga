import type { FetchLike } from "@muga/fsapi-core";
import { type SimulatedHome, startSimulatedHome } from "@muga/fsapi-sim";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpeakerFinder } from "../src/radio/finder.ts";
import { localName, RadioRegistry, type StorageLike } from "../src/radio/registry.ts";
import type { RadioConfig } from "../src/radio/types.ts";

const homes: SimulatedHome[] = [];
const registries: RadioRegistry[] = [];

afterEach(async () => {
  for (const r of registries.splice(0)) r.stop();
  await Promise.all(homes.splice(0).map((h) => h.close()));
});

async function home(speakers = 2) {
  const started = await startSimulatedHome({ speakers });
  homes.push(started);
  return started;
}

/** An address with nothing behind it: a port no one listens on. */
const NOWHERE = "127.0.0.1:1";

/** A registry whose saved speakers are `radios`, as if from an earlier visit. */
function registry(radios: RadioConfig[], hosts: string[] = []) {
  const data = new Map([["muga.radios.v1", JSON.stringify(radios)]]);
  const storage: StorageLike = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
  const r = new RadioRegistry({
    storage,
    controller: { activeIntervalMs: 200, backgroundIntervalMs: 200 },
    multiroom: { intervalMs: 60_000, settleMs: 0 },
    finder: { timeoutMs: 500, ranges: async () => [{ subnet: "test", hosts }] },
    relocateEveryMs: 0,
  });
  registries.push(r);
  return r;
}

const saved = (id: string, host: string, name: string): RadioConfig => ({
  id,
  host,
  pin: "1234",
  name,
});

describe("SpeakerFinder", () => {
  it("finds the speakers that answer, with their identity", async () => {
    const { speakers } = await home(2);
    const hosts = [NOWHERE, ...speakers.map((s) => s.host), "127.0.0.1:2"];
    const finder = new SpeakerFinder(
      { radios: () => [] },
      { timeoutMs: 500, ranges: async () => [{ subnet: "test", hosts }] },
    );
    const progress: number[] = [];
    finder.subscribe(() => progress.push(finder.getSnapshot().done));
    await finder.scan();
    const { status, found, total, subnets } = finder.getSnapshot();
    expect({ status, total, subnets }).toEqual({ status: "done", total: 4, subnets: ["test"] });
    expect(found.map((r) => [r.name, r.radioId, r.pinRequired]).sort()).toEqual([
      ["Kitchen", "002261000002", false],
      ["Living room", "002261000001", false],
    ]);
    expect(progress.at(-1)).toBe(4);
  });

  it("only scans the usual home ranges where a router answers", async () => {
    const asked: string[] = [];
    const fetch: FetchLike = async (url) => {
      asked.push(new URL(url).hostname);
      throw new TypeError("Failed to fetch");
    };
    const routers = new Set(["192.168.178.1"]);
    const finder = new SpeakerFinder(
      { radios: () => [] },
      { fetch, timeoutMs: 50, concurrency: 64, answers: async (host) => routers.has(host) },
    );
    await finder.scan();
    expect(finder.getSnapshot()).toMatchObject({ subnets: ["192.168.178"], total: 254, found: [] });
    expect(asked.every((host) => host.startsWith("192.168.178."))).toBe(true);
  });
});

describe("following a speaker to its new address", () => {
  it("derives a radio's .local name as the radios advertise it", () => {
    expect(localName("Living room")).toBe("Living-room.local");
    expect(localName("Kitchen 2")).toBe("Kitchen-2.local");
    expect(localName("Baño")).toBeUndefined();
  });

  it("finds it in the other speakers' multiroom lists", async () => {
    const { speakers } = await home(2);
    const [living, kitchen] = speakers;
    const r = registry([
      saved("002261000001", NOWHERE, "Living room"),
      saved("002261000002", kitchen?.host ?? "", "Kitchen"),
    ]);
    r.start();
    await vi.waitFor(() => expect(r.getSnapshot().radios[0]?.host).toBe(living?.host), {
      timeout: 5000,
    });
    await vi.waitFor(() =>
      expect(r.controller("002261000001")?.getSnapshot().connection).toBe("online"),
    );
  });

  it("finds it with a scan when nothing else knows where it went", async () => {
    const { speakers } = await home(1);
    const [living] = speakers;
    const r = registry(
      [saved("002261000001", NOWHERE, "Living room")],
      [NOWHERE, living?.host ?? ""],
    );
    r.start();
    await vi.waitFor(() =>
      expect(r.controller("002261000001")?.getSnapshot().connection).toBe("offline"),
    );
    expect(await r.relocate("002261000001", { scan: true })).toBe(true);
    expect(r.getSnapshot().radios[0]?.host).toBe(living?.host);
  });

  it("doesn't take another radio at the old address for this one", async () => {
    const { speakers } = await home(2);
    const [living, kitchen] = speakers;
    // The router gave Living room's old address to Kitchen.
    const r = registry([
      saved("002261000001", kitchen?.host ?? "", "Living room"),
      saved("002261000002", kitchen?.host ?? "", "Kitchen"),
    ]);
    r.start();
    await vi.waitFor(() => expect(r.getSnapshot().radios[0]?.host).toBe(living?.host), {
      timeout: 5000,
    });
    await vi.waitFor(() =>
      expect(r.controller("002261000001")?.getSnapshot().name).toBe("Living room"),
    );
  });

  it("follows a speaker to the fixed address it was given, once it answers there", async () => {
    const { speakers } = await home(1);
    const [living] = speakers;
    const r = registry([saved("002261000001", NOWHERE, "Living room")]);
    expect(await r.expectAt("002261000001", NOWHERE, { timeoutMs: 0 })).toBe(true);
    expect(
      await r.expectAt("002261000001", living?.host ?? "", { timeoutMs: 50, everyMs: 10 }),
    ).toBe(true);
    expect(r.getSnapshot().radios[0]?.host).toBe(living?.host);
  });

  it("gives up waiting at a fixed address where another radio, or none, answers", async () => {
    const { speakers } = await home(2);
    const [, kitchen] = speakers;
    const r = registry([saved("002261000001", NOWHERE, "Living room")]);
    expect(
      await r.expectAt("002261000001", kitchen?.host ?? "", { timeoutMs: 20, everyMs: 10 }),
    ).toBe(false);
    expect(r.getSnapshot().radios[0]?.host).toBe(NOWHERE);
  });
});
