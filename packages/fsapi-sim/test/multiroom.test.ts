import {
  addToGroup,
  createGroup,
  destroyGroup,
  FsapiClient,
  isMultiroomFailure,
  readGroupState,
  readMultiroomDevices,
  removeFromGroup,
} from "@muga/fsapi-core";
import { afterEach, describe, expect, it } from "vitest";
import { type SimulatedHome, type SimulatedHomeOptions, startSimulatedHome } from "../src/index.ts";

const NO_WAITS = { waits: { create: 0, add: 0, destroy: 0, streamable: 0 } };
const NO_MODE = 0xffff_ffff;
let home: SimulatedHome | undefined;

afterEach(async () => {
  await home?.close();
  home = undefined;
});

/** Living room (internet radio), Kitchen (DAB) and Bedroom (standby) on one network. */
async function setup(options: SimulatedHomeOptions = {}) {
  home = await startSimulatedHome(options);
  const [living, kitchen, bedroom] = home.speakers.map((sim) => ({
    sim,
    client: new FsapiClient({ host: sim.host }),
  }));
  if (!living || !kitchen || !bedroom) throw new Error("three speakers expected");
  return { living, kitchen, bedroom };
}

async function grouped() {
  const speakers = await setup();
  const { living, kitchen, bedroom } = speakers;
  await createGroup(living.client, "Downstairs", NO_WAITS);
  await addToGroup(living.client, kitchen.sim.udn, NO_WAITS);
  await addToGroup(living.client, bedroom.sim.udn, NO_WAITS);
  return speakers;
}

describe("simulated multiroom", () => {
  it("lists the other speakers on the network, as real radios do", async () => {
    const { living, kitchen } = await setup();
    const devices = await readMultiroomDevices(kitchen.client);
    expect(devices.map((d) => [d.name, d.role, d.ip])).toEqual([
      ["Living room", "NO_GROUP", living.sim.host],
      ["Bedroom", "NO_GROUP", expect.any(String)],
    ]);
    expect(devices[0]?.udn).toBe(living.sim.udn);
    expect(living.sim.udn).toBe("46C19E4A-472B-11E1-9F67-002261000001");
    await expect(readGroupState(kitchen.client)).resolves.toEqual({
      role: "NO_GROUP",
      groupId: "",
      groupName: "",
      clientNumber: undefined,
      syncVersion: "3",
      listVersion: expect.any(Number),
    });
  });

  it("groups speakers: clients play the server's stream, with no source or name", async () => {
    const { living, kitchen, bedroom } = await grouped();
    const server = await readGroupState(living.client);
    expect(server).toMatchObject({ role: "SERVER", groupName: "Downstairs" });
    expect(server?.groupId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(readGroupState(bedroom.client)).resolves.toMatchObject({
      role: "CLIENT",
      groupId: server?.groupId,
      groupName: "Downstairs",
      clientNumber: 1,
    });
    await expect(living.client.get("netRemote.multiroom.group.attachedClients")).resolves.toBe(2);

    // Bedroom was in standby; clients report no source and no station name.
    await expect(bedroom.client.get("netRemote.sys.power")).resolves.toBe("ON");
    await expect(kitchen.client.get("netRemote.sys.mode")).resolves.toBe(NO_MODE);
    await expect(kitchen.client.get("netRemote.play.info.name")).resolves.toBe("");
    await expect(kitchen.client.get("netRemote.play.status")).resolves.toBe("PLAYING");
    await living.client.set("netRemote.play.control", "PAUSE");
    await expect(bedroom.client.get("netRemote.play.status")).resolves.toBe("PAUSED");

    const devices = await readMultiroomDevices(bedroom.client);
    expect(devices.map((d) => [d.name, d.role, d.clientNumber])).toEqual([
      ["Living room", "SERVER", undefined],
      ["Kitchen", "CLIENT", 0],
    ]);
  });

  it("shows changes in a radio's own nodes at once, and in its list later", async () => {
    const { living, kitchen } = await setup({ network: { listDelayMs: 100 } });
    const settle = () => new Promise((resolve) => setTimeout(resolve, 150));
    await settle(); // the first lists arrive late too
    await createGroup(living.client, "Downstairs", NO_WAITS);
    await addToGroup(living.client, kitchen.sim.udn, NO_WAITS);
    await expect(readGroupState(kitchen.client)).resolves.toMatchObject({ role: "CLIENT" });
    const listed = async () =>
      (await readMultiroomDevices(living.client)).find((d) => d.name === "Kitchen")?.role;
    expect(await listed()).toBe("NO_GROUP");
    await settle();
    expect(await listed()).toBe("CLIENT");
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

  it("sets client volumes and the master volume on the server", async () => {
    const { living, kitchen } = await setup();
    await createGroup(living.client, "Downstairs", NO_WAITS);
    await addToGroup(living.client, kitchen.sim.udn, NO_WAITS);
    // Living room 14, Kitchen 10: the master is their average.
    await expect(living.client.get("netRemote.multiroom.group.masterVolume")).resolves.toBe(12);
    await expect(living.client.get("netRemote.multiroom.client.volume0")).resolves.toBe(10);

    await living.client.set("netRemote.multiroom.client.volume0", 4);
    await expect(kitchen.client.get("netRemote.sys.audio.volume")).resolves.toBe(4);
    await living.client.set("netRemote.multiroom.group.masterVolume", 6);
    await expect(living.client.get("netRemote.sys.audio.volume")).resolves.toBe(9);
    await expect(kitchen.client.get("netRemote.sys.audio.volume")).resolves.toBe(3);

    await kitchen.client.set("netRemote.sys.audio.volume", 9);
    await expect(living.client.get("netRemote.multiroom.client.volume0")).resolves.toBe(9);
    await expect(living.client.get("netRemote.multiroom.group.masterVolume")).resolves.toBe(9);
    await living.client.set("netRemote.multiroom.client.mute0", "MUTE");
    await expect(kitchen.client.get("netRemote.sys.audio.mute")).resolves.toBe("MUTE");
    await expect(living.client.set("netRemote.multiroom.client.volume3", 5)).rejects.toMatchObject({
      fsStatus: "FS_FAIL",
    });
  });

  it("leaves a removed client idle with no source, and ungroups", async () => {
    const { living, kitchen } = await grouped();
    await removeFromGroup(living.client, kitchen.sim.udn, NO_WAITS);
    await expect(readGroupState(kitchen.client)).resolves.toMatchObject({ role: "NO_GROUP" });
    await expect(kitchen.client.get("netRemote.sys.mode")).resolves.toBe(NO_MODE);
    await expect(kitchen.client.get("netRemote.play.status")).resolves.toBe("IDLE");

    await destroyGroup(living.client, NO_WAITS);
    const devices = await readMultiroomDevices(kitchen.client);
    expect(devices.every((d) => d.role === "NO_GROUP" && d.groupId === "")).toBe(true);
    await expect(living.client.get("netRemote.multiroom.group.destroy")).resolves.toBe("IDLE");
  });

  it("accepts UNDOK's hand-over but changes nothing, like real radios", async () => {
    const { living, kitchen } = await grouped();
    await kitchen.client.set("netRemote.multiroom.group.state", "SERVER");
    await kitchen.client.set("netRemote.multiroom.group.becomeServer", "SERVER");
    await expect(readGroupState(kitchen.client)).resolves.toMatchObject({ role: "CLIENT" });
    await expect(readGroupState(living.client)).resolves.toMatchObject({ role: "SERVER" });
  });

  it("lets a speaker with no source lead a group, but not take clients", async () => {
    const { living, kitchen, bedroom } = await grouped();
    await destroyGroup(living.client, NO_WAITS);
    // Kitchen was a client: on, with no source.
    await expect(kitchen.client.get("netRemote.sys.mode")).resolves.toBe(NO_MODE);
    await createGroup(kitchen.client, "Kitchen", NO_WAITS);
    await expect(addToGroup(kitchen.client, bedroom.sim.udn, NO_WAITS)).rejects.toMatchObject({
      fsStatus: "FS_FAIL",
    });
  });

  it("leaves a group when a client picks a source, and ends it when the server can't share", async () => {
    const { living, kitchen, bedroom } = await grouped();
    await kitchen.client.set("netRemote.sys.mode", 1);
    await expect(readGroupState(kitchen.client)).resolves.toMatchObject({ role: "NO_GROUP" });
    await expect(kitchen.client.get("netRemote.play.info.name")).resolves.toBe("Spotify");
    await expect(living.client.get("netRemote.multiroom.group.attachedClients")).resolves.toBe(1);

    await living.client.set("netRemote.sys.mode", 4); // FM can't be shared in the simulator
    await expect(readGroupState(living.client)).resolves.toMatchObject({ role: "NO_GROUP" });
    await expect(readGroupState(bedroom.client)).resolves.toMatchObject({ role: "NO_GROUP" });
  });
});
