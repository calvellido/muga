import { FsapiClient } from "@muga/fsapi-core";
import { afterEach, describe, expect, it } from "vitest";
import { type RadioSimulator, type SimulatorOptions, startSimulator } from "../src/index.ts";

let sim: RadioSimulator | undefined;

async function setup(options: SimulatorOptions = {}) {
  sim = await startSimulator({ notifyHoldMs: 300, ...options });
  return { sim, client: new FsapiClient({ host: sim.host, pin: sim.pin, notifyTimeoutMs: 2_000 }) };
}

afterEach(async () => {
  await sim?.close();
  sim = undefined;
});

describe("client ↔ simulator contract", () => {
  it("serves CORS headers like the real radios", async () => {
    const { sim } = await setup();
    const response = await fetch(`${sim.url}/fsapi/GET/netRemote.sys.info.friendlyName?pin=1234`);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("content-type")).toBe("text/xml");
  });

  it("reads typed scalars", async () => {
    const { client } = await setup();
    await expect(client.get("netRemote.sys.info.friendlyName")).resolves.toBe("Muga Simulator");
    await expect(client.get("netRemote.sys.power")).resolves.toBe("ON");
    await expect(client.get("netRemote.sys.audio.volume")).resolves.toBe(8);
    await expect(client.get("netRemote.sys.net.wlan.connectedSSID")).resolves.toBe("MugaNet");
  });

  it("writes values and reads them back", async () => {
    const { sim, client } = await setup();
    await client.set("netRemote.sys.audio.volume", 20);
    await client.set("netRemote.sys.info.friendlyName", "Cocina & salón");
    expect(sim.get("netRemote.sys.audio.volume")).toBe(20);
    await expect(client.get("netRemote.sys.info.friendlyName")).resolves.toBe("Cocina & salón");
  });

  it("answers FS_PACKET_BAD for read-only nodes and FS_NODE_DOES_NOT_EXIST for missing ones", async () => {
    const { client } = await setup({ profile: { missingNodes: ["netRemote.sys.caps.fsdca"] } });
    await expect(client.setRaw("netRemote.play.status", "1")).rejects.toMatchObject({
      kind: "status",
      fsStatus: "FS_PACKET_BAD",
    });
    await expect(client.get("netRemote.sys.caps.fsdca")).rejects.toMatchObject({
      fsStatus: "FS_NODE_DOES_NOT_EXIST",
    });
  });

  it("rejects a wrong PIN with HTTP 403", async () => {
    const { sim } = await setup({ pin: "4321" });
    const client = new FsapiClient({ host: sim.host, pin: "1234" });
    await expect(client.get("netRemote.sys.power")).rejects.toMatchObject({ kind: "pin" });
  });

  it("uses GET_MULTIPLE and SET_MULTIPLE when available", async () => {
    const { sim, client } = await setup();
    const result = await client.getMultiple([
      "netRemote.sys.power",
      "netRemote.sys.mode",
      "netRemote.play.info.name",
    ]);
    expect(result.values).toEqual({
      "netRemote.sys.power": "ON",
      "netRemote.sys.mode": 0,
      "netRemote.play.info.name": "Radio Muga",
    });
    const errors = await client.setMultiple([
      ["netRemote.sys.audio.volume", 3],
      ["netRemote.sys.audio.mute", "MUTE"],
    ]);
    expect(errors).toEqual({});
    expect(sim.get("netRemote.sys.audio.mute")).toBe(1);
    expect(sim.requests.filter((r) => r.verb.endsWith("MULTIPLE"))).toHaveLength(2);
  });

  it("falls back to single requests on firmware without the MULTIPLE verbs", async () => {
    const { client } = await setup({ supportsMultiple: false });
    const result = await client.getMultiple(["netRemote.sys.power", "netRemote.sys.mode"]);
    expect(result.values).toEqual({ "netRemote.sys.power": "ON", "netRemote.sys.mode": 0 });
    expect(client.supportsMultiple).toBe(false);
  });

  it("pages through lists", async () => {
    const { client } = await setup();
    const modes = await client.listAllItems("netRemote.sys.caps.validModes", { pageSize: 3 });
    expect(modes.map((m) => m.id)).toEqual([
      "IR",
      "Spotify",
      "DMR",
      "DAB",
      "FM",
      "BLUETOOTH",
      "AUXIN",
    ]);
    expect(modes[0]).toMatchObject({ key: 0, label: "Internet radio", selectable: 1, modeType: 0 });

    const page = await client.listGetNext("netRemote.sys.caps.validModes", {
      startKey: 4,
      maxItems: 10,
    });
    expect(page.items.map((m) => m.key)).toEqual([5, 6]);
    expect(page.listEnd).toBe(true);

    const end = await client.listGetNext("netRemote.sys.caps.validModes", { startKey: 6 });
    expect(end).toEqual({ items: [], listEnd: true });
  });

  it("updates list items with LIST_SET", async () => {
    const { sim, client } = await setup();
    await client.listSet("netRemote.nav.presets", 2, { name: "Nueva", type: "IR" });
    expect(sim.list("netRemote.nav.presets").find((p) => p.key === 2)).toMatchObject({
      name: "Nueva",
      type: "IR",
    });
  });

  it("reads the /device document", async () => {
    const { sim, client } = await setup();
    await expect(client.getDeviceDocument()).resolves.toEqual({
      friendlyName: "Muga Simulator",
      version: "ir-mmi-FS2026-0500-0000_V2.14.35.SIM",
      webfsapi: `${sim.url}/fsapi`,
    });
  });
});

describe("sessions and notifications", () => {
  it("delivers notifications for changes made after the long-poll started", async () => {
    const { sim, client } = await setup();
    const sid = await client.createSession();
    const poll = client.getNotifies(sid);
    setTimeout(() => sim.set("netRemote.sys.audio.volume", 15), 50);
    await expect(poll).resolves.toEqual([
      {
        node: "netRemote.sys.audio.volume",
        path: "netRemote.sys.audio.volume",
        value: 15,
        wire: { tag: "u8", text: "15" },
      },
    ]);
  });

  it("answers FS_TIMEOUT when nothing changed", async () => {
    const { client } = await setup();
    const sid = await client.createSession();
    await expect(client.getNotifies(sid)).resolves.toEqual([]);
  });

  it("invalidates the previous session when another controller creates one", async () => {
    const { sim, client } = await setup();
    const first = await client.createSession();
    const other = new FsapiClient({ host: sim.host });
    const poll = client.getNotifies(first).catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 30));
    await other.createSession();
    await expect(poll).resolves.toMatchObject({ kind: "not-found" });
    await expect(client.getNotifies(first)).rejects.toMatchObject({ kind: "not-found" });
    // Plain PIN requests keep working without a session.
    await expect(client.get("netRemote.sys.power")).resolves.toBe("ON");
  });
});
