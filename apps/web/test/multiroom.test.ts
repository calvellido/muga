import type { MultiroomDevice } from "@muga/fsapi-core";
import { type SimulatedHome, startSimulatedHome, startSimulator } from "@muga/fsapi-sim";
import { afterEach, describe, expect, it, vi } from "vitest";
import { matchSpeaker } from "../src/radio/multiroom.ts";
import { RadioRegistry } from "../src/radio/registry.ts";

const homes: SimulatedHome[] = [];
const registries: RadioRegistry[] = [];
const NO_WAITS = { create: 0, add: 0, handOver: 0, destroy: 0 };

afterEach(async () => {
  for (const r of registries.splice(0)) r.stop();
  await Promise.all(homes.splice(0).map((h) => h.close()));
});

/** A home of `speakers`, of which the first `saved` are connected to a registry. */
async function setup(speakers = 3, saved = speakers, listsItself = true) {
  const home = await startSimulatedHome({ speakers, network: { listsItself } });
  homes.push(home);
  const registry = new RadioRegistry({
    controller: { activeIntervalMs: 60_000, backgroundIntervalMs: 60_000 },
    multiroom: { intervalMs: 60_000, settleMs: 0, waits: NO_WAITS },
  });
  registries.push(registry);
  const ids: string[] = [];
  for (const sim of home.speakers.slice(0, saved)) ids.push((await registry.connect(sim.host)).id);
  // Every speaker online, then the network read once.
  await Promise.all(ids.map((id) => registry.controller(id)?.refreshNow()));
  await registry.multiroom.refresh(true);
  return { home, registry, directory: registry.multiroom, ids };
}

const device = (udn: string, ip = ""): MultiroomDevice => ({
  udn,
  ip,
  name: "",
  syncVersion: "",
  groupId: "",
  groupName: "",
  role: "NO_GROUP",
  clientNumber: undefined,
  stereo: { id: "", role: "INDEPENDENT", name: "" },
});

describe("matchSpeaker", () => {
  const radios = [
    { config: { id: "002261AABBCC", host: "192.0.2.10", pin: "1234", name: "" }, udn: "" },
    {
      config: { id: "192.0.2.11", host: "192.0.2.11", pin: "1234", name: "" },
      udn: "uuid:3dcc7100-f76c-11dd-87af-002261ddeeff",
    },
    { config: { id: "x", host: "http://192.0.2.12:80/fsapi", pin: "1234", name: "" }, udn: "" },
  ];

  it("finds a saved speaker by the end of its UDN, its UPnP UDN or its address", () => {
    expect(matchSpeaker(device("46C19E4A-472B-11E1-9F67-002261aabbcc"), radios)).toBe(
      "002261AABBCC",
    );
    expect(matchSpeaker(device("46C19E4A-472B-11E1-9F67-002261DDEEFF"), radios)).toBe("192.0.2.11");
    expect(matchSpeaker(device("46C19E4A-472B-11E1-9F67-000000000000", "192.0.2.12"), radios)).toBe(
      "x",
    );
    expect(matchSpeaker(device("46C19E4A-472B-11E1-9F67-000000000000", "192.0.2.99"), radios)).toBe(
      undefined,
    );
  });
});

describe("MultiroomDirectory", () => {
  it("lists the network's speakers, saved or not", async () => {
    const { directory, ids } = await setup(3, 2);
    const { status, speakers, groups } = directory.getSnapshot();
    expect(status).toBe("ready");
    expect(groups).toEqual([]);
    expect(speakers.map((s) => [s.name, s.radioId])).toEqual([
      ["Living room", ids[0]],
      ["Kitchen", ids[1]],
      ["Bedroom", undefined],
    ]);
  });

  it("creates a group and shows it through its server", async () => {
    const { home, registry, directory, ids } = await setup();
    const [living, kitchen, bedroom] = home.speakers;
    const [livingId = "", kitchenId = "", bedroomId = ""] = ids;
    expect(
      await directory.create(livingId, [kitchen?.udn ?? "", bedroom?.udn ?? ""], "Downstairs"),
    ).toBe(true);
    const [group] = directory.getSnapshot().groups;
    expect(group?.name).toBe("Downstairs");
    expect(group?.server.radioId).toBe(livingId);
    expect(group?.clients.map((c) => [c.radioId, c.clientNumber])).toEqual([
      [kitchenId, 0],
      [bedroomId, 1],
    ]);
    expect(directory.groupOf(bedroomId)?.id).toBe(group?.id);

    registry.select(kitchenId);
    registry.selectGroupOf(kitchenId);
    expect(registry.getSnapshot()).toMatchObject({ activeId: livingId, activeGroupId: group?.id });

    // The server's controller now reads the group's volumes too.
    const server = registry.controller(livingId);
    await server?.refreshNow();
    expect(server?.getSnapshot().mixer).toEqual({
      master: 14,
      clients: [
        { volume: 10, muted: false },
        { volume: 6, muted: false },
        { volume: 0, muted: false },
        { volume: 0, muted: false },
      ],
    });
    await server?.mixer.setClientVolume(1, 9);
    expect(bedroom?.get("netRemote.sys.audio.volume")).toBe(9);
    await server?.mixer.setMaster(7);
    expect(living?.get("netRemote.sys.audio.volume")).toBe(7);
    expect(kitchen?.get("netRemote.sys.audio.volume")).toBe(5);
    await server?.mixer.setGroupMute(true, [0, 1]);
    expect(kitchen?.get("netRemote.sys.audio.mute")).toBe(1);
    expect(living?.get("netRemote.sys.audio.mute")).toBe(1);

    registry.select(livingId);
    expect(registry.getSnapshot().activeGroupId).toBeUndefined();
    expect(server?.getSnapshot().mixer).toBeUndefined();
  });

  it("includes the speaker it asked when its own list leaves it out", async () => {
    const { home, directory, ids } = await setup(2, 2, false);
    const [livingId = "", kitchenId = ""] = ids;
    // Read from Kitchen, the selected speaker: it lists only Living room.
    const listed = directory.getSnapshot().speakers.map((s) => [s.name, s.radioId]);
    expect(listed.sort()).toEqual([
      ["Kitchen", kitchenId],
      ["Living room", livingId],
    ]);
    await directory.create(livingId, [home.speakers[1]?.udn ?? ""], "Downstairs");
    const [group] = directory.getSnapshot().groups;
    expect(group?.server.radioId).toBe(livingId);
    expect(group?.clients.map((c) => c.radioId)).toEqual([kitchenId]);
  });

  it("refuses to group from a source that can't be shared", async () => {
    const { home, directory, ids } = await setup(2);
    // Kitchen plays DAB.
    expect(await directory.create(ids[1] ?? "", [home.speakers[0]?.udn ?? ""], "Group 1")).toBe(
      false,
    );
    expect(directory.getSnapshot().lastError?.message).toMatch(/can't be shared/);
    expect(directory.getSnapshot().groups).toEqual([]);
  });

  it("adds and removes speakers, renames, and follows a hand-over", async () => {
    const { home, registry, directory, ids } = await setup(4);
    const [living, kitchen, bedroom, study] = home.speakers.map((s) => s.udn);
    const [livingId = "", , bedroomId = ""] = ids;
    await directory.create(livingId, [kitchen ?? ""], "Downstairs");
    const first = directory.getSnapshot().groups[0];
    registry.selectGroup(first?.id ?? "");

    await directory.edit(first?.id ?? "", {
      name: "Downstairs",
      members: [living ?? "", bedroom ?? "", study ?? ""],
    });
    let group = directory.getSnapshot().groups[0];
    expect(group?.id).toBe(first?.id);
    expect(group?.clients.map((c) => c.name)).toEqual(["Bedroom", "Study"]);

    // A new name builds the group again, with a new id; the view follows it.
    await directory.edit(group?.id ?? "", {
      name: "Ground floor",
      members: [living ?? "", bedroom ?? "", study ?? ""],
    });
    group = directory.getSnapshot().groups[0];
    expect(group?.name).toBe("Ground floor");
    expect(group?.id).not.toBe(first?.id);
    expect(group?.clients.map((c) => c.name)).toEqual(["Bedroom", "Study"]);
    expect(registry.getSnapshot().activeGroupId).toBe(group?.id);

    // The server leaves: Bedroom takes over, and the view moves to it.
    await directory.edit(group?.id ?? "", {
      name: "Ground floor",
      members: [bedroom ?? "", study ?? ""],
    });
    group = directory.getSnapshot().groups[0];
    expect(group?.server.name).toBe("Bedroom");
    expect(group?.clients.map((c) => c.name)).toEqual(["Study"]);
    expect(registry.getSnapshot()).toMatchObject({ activeId: bedroomId, activeGroupId: group?.id });
    expect(registry.controller(livingId)?.getSnapshot().mixer).toBeUndefined();
  });

  it("leaves and ungroups, and the view goes back to the speaker", async () => {
    const { home, registry, directory, ids } = await setup(3);
    const [livingId = "", kitchenId = "", bedroomId = ""] = ids;
    const udns = home.speakers.map((s) => s.udn);
    await directory.create(livingId, udns.slice(1), "Downstairs");
    registry.selectGroupOf(livingId);

    // A client leaves; the server leaving a group of two ungroups it.
    expect(await directory.leave(kitchenId)).toBe(true);
    expect(directory.getSnapshot().groups[0]?.clients.map((c) => c.radioId)).toEqual([bedroomId]);
    expect(await directory.leave(livingId)).toBe(true);
    expect(directory.getSnapshot().groups).toEqual([]);
    expect(registry.getSnapshot()).toMatchObject({ activeId: livingId, activeGroupId: undefined });

    await directory.create(livingId, udns.slice(1), "Downstairs");
    const group = directory.getSnapshot().groups[0];
    expect(await directory.dissolve(group?.id ?? "")).toBe(true);
    expect(directory.getSnapshot().groups).toEqual([]);
    expect(home.speakers[1]?.get("netRemote.multiroom.group.state")).toBe(0);
  });

  it("reads the list again when a speaker it doesn't list yet comes online", async () => {
    // Two networks, so each speaker lists only itself, and no timer reads it again.
    const sims = await Promise.all(
      ["Kitchen", "Living room"].map((name, i) =>
        startSimulator({
          profile: {
            values: {
              "netRemote.sys.info.friendlyName": name,
              "netRemote.sys.info.radioId": `00226100000${i + 1}`,
            },
          },
        }),
      ),
    );
    const registry = new RadioRegistry({
      controller: { activeIntervalMs: 60_000, backgroundIntervalMs: 60_000 },
      multiroom: { intervalMs: 60_000, settleMs: 0 },
    });
    registries.push(registry);
    try {
      const kitchen = await registry.connect(sims[0]?.host ?? "");
      await vi.waitFor(() => expect(registry.multiroom.speaker(kitchen.id)).toBeDefined());
      const living = await registry.connect(sims[1]?.host ?? "");
      await vi.waitFor(() =>
        expect(registry.multiroom.speaker(living.id)?.name).toBe("Living room"),
      );
    } finally {
      await Promise.all(sims.map((s) => s.close()));
    }
  });

  it("reports when no saved speaker has multiroom", async () => {
    const sim = await startSimulator({
      profile: {
        missingNodes: [
          "netRemote.multiroom.device.listAll",
          "netRemote.multiroom.device.listAllVersion",
        ],
      },
    });
    const registry = new RadioRegistry({
      controller: { activeIntervalMs: 60_000, backgroundIntervalMs: 60_000 },
      multiroom: { intervalMs: 60_000, settleMs: 0 },
    });
    registries.push(registry);
    try {
      const { id } = await registry.connect(sim.host);
      await registry.controller(id)?.refreshNow();
      await registry.multiroom.refresh(true);
      expect(registry.multiroom.getSnapshot().status).toBe("unsupported");
    } finally {
      await sim.close();
    }
  });
});
