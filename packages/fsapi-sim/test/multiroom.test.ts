import {
  addToGroup,
  createGroup,
  destroyGroup,
  FsapiClient,
  handOverGroup,
  isMultiroomFailure,
  readMultiroomDevices,
  removeFromGroup,
} from "@muga/fsapi-core";
import { afterEach, describe, expect, it } from "vitest";
import { type SimulatedHome, startSimulatedHome } from "../src/index.ts";

const NO_WAITS = { waits: { create: 0, add: 0, handOver: 0, destroy: 0 } };
let home: SimulatedHome | undefined;

afterEach(async () => {
  await home?.close();
  home = undefined;
});

/** Living room (internet radio), Kitchen (DAB) and Bedroom (standby) on one network. */
async function setup() {
  home = await startSimulatedHome();
  const [living, kitchen, bedroom] = home.speakers.map((sim) => ({
    sim,
    client: new FsapiClient({ host: sim.host }),
  }));
  if (!living || !kitchen || !bedroom) throw new Error("three speakers expected");
  return { living, kitchen, bedroom };
}

describe("simulated multiroom", () => {
  it("lists every speaker on the network from any of them", async () => {
    const { living, kitchen } = await setup();
    const devices = await readMultiroomDevices(kitchen.client);
    expect(devices.map((d) => [d.name, d.role, d.ip])).toEqual([
      ["Living room", "NO_GROUP", living.sim.host],
      ["Kitchen", "NO_GROUP", kitchen.sim.host],
      ["Bedroom", "NO_GROUP", expect.any(String)],
    ]);
    expect(devices[0]?.udn).toBe(living.sim.udn);
    expect(living.sim.udn).toBe("46C19E4A-472B-11E1-9F67-002261000001");
  });

  it("groups speakers: clients follow the server, and every speaker sees the group", async () => {
    const { living, kitchen, bedroom } = await setup();
    const before = await kitchen.client.get("netRemote.multiroom.device.listAllVersion");
    const id = await createGroup(living.client, "Downstairs", NO_WAITS);
    await addToGroup(living.client, kitchen.sim.udn, NO_WAITS);
    await addToGroup(living.client, bedroom.sim.udn, NO_WAITS);

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    await expect(living.client.get("netRemote.multiroom.group.state")).resolves.toBe("SERVER");
    await expect(kitchen.client.get("netRemote.multiroom.group.state")).resolves.toBe("CLIENT");
    await expect(bedroom.client.get("netRemote.multiroom.group.name")).resolves.toBe("Downstairs");
    await expect(living.client.get("netRemote.multiroom.group.attachedClients")).resolves.toBe(2);
    expect(await kitchen.client.get("netRemote.multiroom.device.listAllVersion")).toBeGreaterThan(
      before,
    );

    // Bedroom was in standby; clients play the server's stream in the hidden Audsync source.
    await expect(bedroom.client.get("netRemote.sys.power")).resolves.toBe("ON");
    await expect(kitchen.client.get("netRemote.sys.mode")).resolves.toBe(7);
    await expect(kitchen.client.get("netRemote.play.info.name")).resolves.toBe("Radio Muga");
    await living.client.set("netRemote.nav.action.selectPreset", 1);
    await expect(bedroom.client.get("netRemote.play.info.name")).resolves.toBe("Frontera FM");

    const devices = await readMultiroomDevices(bedroom.client);
    expect(devices.map((d) => [d.name, d.role, d.clientNumber, d.groupId])).toEqual([
      ["Living room", "SERVER", undefined, id],
      ["Kitchen", "CLIENT", 0, id],
      ["Bedroom", "CLIENT", 1, id],
    ]);
  });

  it("only groups from a source that can be shared", async () => {
    const { kitchen } = await setup();
    await expect(kitchen.client.get("netRemote.multiroom.group.streamable")).resolves.toBe("FALSE");
    const error = await createGroup(kitchen.client, "Kitchen", NO_WAITS).catch((e: unknown) => e);
    expect(isMultiroomFailure(error)).toBe(true);
    await expect(
      kitchen.client.set("netRemote.multiroom.group.create", "Kitchen"),
    ).rejects.toMatchObject({ fsStatus: "FS_FAIL" });
  });

  it("controls client volumes and the master volume on the server", async () => {
    const { living, kitchen } = await setup();
    await createGroup(living.client, "Downstairs", NO_WAITS);
    await addToGroup(living.client, kitchen.sim.udn, NO_WAITS);
    // Living room 14, Kitchen 10: the master is the loudest.
    await expect(living.client.get("netRemote.multiroom.group.masterVolume")).resolves.toBe(14);
    await expect(living.client.get("netRemote.multiroom.client.volume0")).resolves.toBe(10);

    await living.client.set("netRemote.multiroom.client.volume0", 4);
    await expect(kitchen.client.get("netRemote.sys.audio.volume")).resolves.toBe(4);
    await living.client.set("netRemote.multiroom.group.masterVolume", 7);
    await expect(living.client.get("netRemote.sys.audio.volume")).resolves.toBe(7);
    await expect(kitchen.client.get("netRemote.sys.audio.volume")).resolves.toBe(2);

    await kitchen.client.set("netRemote.sys.audio.volume", 9);
    await expect(living.client.get("netRemote.multiroom.client.volume0")).resolves.toBe(9);
    await expect(living.client.get("netRemote.multiroom.group.masterVolume")).resolves.toBe(9);
    await living.client.set("netRemote.multiroom.client.mute0", "MUTE");
    await expect(kitchen.client.get("netRemote.sys.audio.mute")).resolves.toBe("MUTE");
    await expect(living.client.set("netRemote.multiroom.client.volume3", 5)).rejects.toMatchObject({
      fsStatus: "FS_FAIL",
    });
  });

  it("removes a client, which goes back to its own source, and ungroups", async () => {
    const { living, kitchen, bedroom } = await setup();
    await createGroup(living.client, "Downstairs", NO_WAITS);
    await addToGroup(living.client, kitchen.sim.udn, NO_WAITS);
    await addToGroup(living.client, bedroom.sim.udn, NO_WAITS);

    await removeFromGroup(living.client, kitchen.sim.udn, NO_WAITS);
    await expect(kitchen.client.get("netRemote.multiroom.group.state")).resolves.toBe("NO_GROUP");
    await expect(kitchen.client.get("netRemote.sys.mode")).resolves.toBe(3);
    await expect(kitchen.client.get("netRemote.play.status")).resolves.toBe("STOPPED");

    await destroyGroup(living.client, NO_WAITS);
    const devices = await readMultiroomDevices(living.client);
    expect(devices.every((d) => d.role === "NO_GROUP" && d.groupId === "")).toBe(true);
    await expect(living.client.get("netRemote.multiroom.group.destroy")).resolves.toBe("IDLE");
  });

  it("hands the server role to a client so the old server can leave", async () => {
    const { living, kitchen, bedroom } = await setup();
    await createGroup(living.client, "Downstairs", NO_WAITS);
    await addToGroup(living.client, kitchen.sim.udn, NO_WAITS);
    await addToGroup(living.client, bedroom.sim.udn, NO_WAITS);

    await handOverGroup(kitchen.client, living.sim.udn, NO_WAITS);
    const devices = await readMultiroomDevices(bedroom.client);
    expect(devices.map((d) => [d.name, d.role, d.groupName])).toEqual([
      ["Living room", "NO_GROUP", ""],
      ["Kitchen", "SERVER", "Downstairs"],
      ["Bedroom", "CLIENT", "Downstairs"],
    ]);
    // The new server plays what the group played.
    await expect(kitchen.client.get("netRemote.sys.mode")).resolves.toBe(0);
    await expect(bedroom.client.get("netRemote.play.info.name")).resolves.toBe("Radio Muga");
  });

  it("leaves a group when a client picks a source, and ends it when the server can't share", async () => {
    const { living, kitchen, bedroom } = await setup();
    await createGroup(living.client, "Downstairs", NO_WAITS);
    await addToGroup(living.client, kitchen.sim.udn, NO_WAITS);
    await addToGroup(living.client, bedroom.sim.udn, NO_WAITS);

    await kitchen.client.set("netRemote.sys.mode", 1);
    await expect(kitchen.client.get("netRemote.multiroom.group.state")).resolves.toBe("NO_GROUP");
    await expect(kitchen.client.get("netRemote.play.info.name")).resolves.toBe("Spotify");
    await expect(living.client.get("netRemote.multiroom.group.attachedClients")).resolves.toBe(1);

    await living.client.set("netRemote.sys.mode", 4); // FM can't be shared
    await expect(living.client.get("netRemote.multiroom.group.state")).resolves.toBe("NO_GROUP");
    await expect(bedroom.client.get("netRemote.multiroom.group.state")).resolves.toBe("NO_GROUP");
  });
});
