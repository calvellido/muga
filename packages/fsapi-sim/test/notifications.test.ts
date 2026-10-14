import { FsapiClient, type Notification, NotificationSession } from "@muga/fsapi-core";
import { afterEach, describe, expect, it } from "vitest";
import { type RadioSimulator, startSimulator } from "../src/index.ts";

let sim: RadioSimulator | undefined;
let session: NotificationSession | undefined;

afterEach(async () => {
  await session?.stop();
  await sim?.close();
  session = undefined;
  sim = undefined;
});

const waitFor = async (predicate: () => boolean, timeoutMs = 3_000) => {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("condition not met in time");
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe("NotificationSession", () => {
  it("streams changes and cleans up its session on stop", async () => {
    sim = await startSimulator({ notifyHoldMs: 200 });
    const client = new FsapiClient({ host: sim.host });
    const received: Notification[] = [];
    session = new NotificationSession(client, { onNotification: (n) => received.push(n) });
    session.start();
    await waitFor(() => sim?.sessionId !== undefined);

    sim.set("netRemote.play.status", "PAUSED");
    sim.set("netRemote.sys.audio.volume", 4);
    await waitFor(() => received.length >= 2);
    expect(received.map((n) => [n.path, n.value])).toEqual(
      expect.arrayContaining([
        ["netRemote.play.status", "PAUSED"],
        ["netRemote.sys.audio.volume", 4],
      ]),
    );

    await session.stop();
    expect(sim.sessionId).toBeUndefined();
  });

  it("reports a takeover, backs off, and then re-creates its session", async () => {
    sim = await startSimulator({ notifyHoldMs: 200 });
    const client = new FsapiClient({ host: sim.host });
    let lost = 0;
    const sessions: string[] = [];
    session = new NotificationSession(client, {
      onNotification: () => undefined,
      onSessionLost: () => lost++,
      onSessionStarted: (sid) => sessions.push(sid),
      takeoverBackoffMs: 100,
    });
    session.start();
    await waitFor(() => sessions.length === 1);

    await new FsapiClient({ host: sim.host }).createSession(); // e.g. UNDOK on a phone
    await waitFor(() => lost === 1);
    await waitFor(() => sessions.length === 2);
    expect(sim.sessionId).toBe(sessions[1]);
  });
});
