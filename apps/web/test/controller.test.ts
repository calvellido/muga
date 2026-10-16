import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { type RadioSimulator, type SimulatorOptions, startSimulator } from "@muga/fsapi-sim";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RadioController, type RadioControllerOptions } from "../src/radio/controller.ts";

let sim: RadioSimulator | undefined;
let controller: RadioController | undefined;

afterEach(async () => {
  controller?.stop();
  await sim?.close();
  sim = undefined;
  controller = undefined;
});

/** Polling timers are long; tests drive polls explicitly with refreshNow(). */
async function setup(
  options: { sim?: SimulatorOptions; controller?: RadioControllerOptions; pin?: string } = {},
) {
  sim = await startSimulator(options.sim);
  controller = new RadioController(
    { id: "sim", host: sim.host, pin: options.pin ?? "1234", name: "Sim" },
    { activeIntervalMs: 60_000, backgroundIntervalMs: 60_000, navPollMs: 5, ...options.controller },
  );
  controller.start(true);
  await controller.refreshNow();
  return { sim, controller };
}

describe("RadioController", () => {
  it("loads identity, selectable sources and now playing", async () => {
    const { controller } = await setup();
    const s = controller.getSnapshot();
    expect(s.connection).toBe("online");
    expect(s).toMatchObject({
      name: "Muga Simulator",
      model: "Muga Sim",
      volumeSteps: 33,
      power: true,
      volume: 8,
    });
    expect(s.modes.map((m) => m.id)).toEqual(["IR", "Spotify", "DAB", "FM", "BLUETOOTH", "AUXIN"]);
    expect(s.play).toMatchObject({
      status: "PLAYING",
      name: "Radio Muga",
      text: "Simulated broadcast",
    });
    expect(s.play.caps).not.toBe(0);
  });

  it("reads a background radio in full as soon as it's selected", async () => {
    sim = await startSimulator();
    controller = new RadioController(
      { id: "sim", host: sim.host, pin: "1234", name: "Sim" },
      { activeIntervalMs: 60_000, backgroundIntervalMs: 60_000 },
    );
    controller.start(false);
    await controller.refreshNow();
    // Let the poll queued by start() finish too, so only the next timer (a minute) is left.
    await new Promise((resolve) => setTimeout(resolve, 50));
    await controller.refreshNow();
    // Background polls leave out the track details.
    expect(controller.getSnapshot().play.text).toBe("");
    // What the registry does when the radio is selected.
    controller.start(true);
    await vi.waitFor(() => expect(controller?.getSnapshot().play.text).toBe("Simulated broadcast"));
  });

  it("reads a watched radio in full without selecting it", async () => {
    sim = await startSimulator();
    controller = new RadioController(
      { id: "sim", host: sim.host, pin: "1234", name: "Sim" },
      { activeIntervalMs: 60_000, backgroundIntervalMs: 60_000 },
    );
    controller.start(false);
    await controller.refreshNow();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(controller.getSnapshot().play.text).toBe("");
    // A grouped speaker's page shows its server's playback.
    const release = controller.watch();
    await vi.waitFor(() => expect(controller?.getSnapshot().play.text).toBe("Simulated broadcast"));
    release();
    release();
    sim.set("netRemote.play.info.text", "Changed");
    await controller.refreshNow();
    // Back to background reads, which leave the text alone.
    expect(controller.getSnapshot().play.text).toBe("Simulated broadcast");
  });

  it("coalesces rapid volume changes: latest value wins, one SET in flight", async () => {
    const { sim, controller } = await setup();
    const results = [3, 4, 5, 6, 7].map((v) => controller.setVolume(v));
    expect(controller.getSnapshot().volume).toBe(7);
    await Promise.all(results);
    expect(sim.get("netRemote.sys.audio.volume")).toBe(7);
    const sets = sim.requests.filter(
      (r) => r.verb === "SET" && r.node === "netRemote.sys.audio.volume",
    );
    expect(sets.length).toBeLessThan(5);
  });

  it("clamps volume to the radio's steps", async () => {
    const { sim, controller } = await setup();
    await controller.setVolume(500);
    expect(sim.get("netRemote.sys.audio.volume")).toBe(32);
  });

  it("powers the radio on before switching source from standby", async () => {
    const { sim, controller } = await setup();
    await controller.setPower(false);
    await controller.refreshNow();
    expect(controller.getSnapshot().power).toBe(false);

    await controller.setMode(3);
    expect(sim.get("netRemote.sys.power")).toBe(1);
    expect(sim.get("netRemote.sys.mode")).toBe(3);
    await controller.refreshNow();
    expect(controller.getSnapshot()).toMatchObject({
      power: true,
      modeKey: 3,
      play: { name: "DAB" },
    });
  });

  it("toggles between play and pause using the radio's capabilities", async () => {
    const { sim, controller } = await setup();
    await controller.togglePlay();
    expect(sim.get("netRemote.play.status")).toBe(3); // PAUSED
    await controller.refreshNow();
    await controller.togglePlay();
    expect(sim.get("netRemote.play.status")).toBe(2); // PLAYING
  });

  it("loads presets after making navigation ready, and recalls one", async () => {
    const { sim, controller } = await setup();
    await controller.presets.load();
    expect(sim.get("netRemote.nav.state")).toBe(1);
    const { presets } = controller.getSnapshot();
    expect(presets.status).toBe("ready");
    expect(presets.items.map((p) => p.name)).toEqual(["Radio Muga", "Frontera FM", "", ""]);

    await controller.presets.select(1);
    await controller.refreshNow();
    expect(controller.getSnapshot()).toMatchObject({
      currentPreset: 1,
      play: { name: "Frontera FM" },
    });
  });

  it("reports presets as unsupported when nav.caps lacks the presets bit", async () => {
    const { controller } = await setup({
      sim: { profile: { values: { "netRemote.nav.caps": 1 } } },
    });
    await controller.presets.load();
    expect(controller.getSnapshot().presets.status).toBe("unsupported");
  });

  it("asks for the PIN when it's rejected and resumes once it's corrected", async () => {
    const { controller } = await setup({ sim: { pin: "4321" } });
    expect(controller.getSnapshot().connection).toBe("pin-required");
    controller.setPin("4321");
    await controller.refreshNow();
    expect(controller.getSnapshot().connection).toBe("online");
  });

  it("goes offline when the radio disappears and recovers when it's back", async () => {
    const { sim: first, controller } = await setup();
    const port = Number(first.host.split(":").at(-1));
    await first.close();
    await controller.refreshNow();
    expect(controller.getSnapshot().connection).toBe("offline");

    sim = await startSimulator({ port });
    await controller.refreshNow();
    expect(controller.getSnapshot().connection).toBe("online");
  });

  it("counts a server that isn't a radio as unreachable, so the radio can be looked for", async () => {
    // A printer, say, that got the radio's old address.
    const server = createServer((_, res) => res.writeHead(404).end("Not found"));
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const { port } = server.address() as AddressInfo;
    controller = new RadioController(
      { id: "002261000001", host: `127.0.0.1:${port}`, pin: "1234", name: "Sim" },
      { activeIntervalMs: 60_000, backgroundIntervalMs: 60_000 },
    );
    controller.start(true);
    await controller.refreshNow();
    expect(controller.getSnapshot().connection).toBe("offline");
    await new Promise<void>((done) => server.close(() => done()));
  });

  it("surfaces failed actions as lastError", async () => {
    const { controller } = await setup({
      sim: { profile: { missingNodes: ["netRemote.play.shuffle"] } },
    });
    expect(await controller.setShuffle(true)).toBe(false);
    expect(controller.getSnapshot().lastError).toMatchObject({ action: "shuffle", kind: "status" });
    controller.clearError();
    expect(controller.getSnapshot().lastError).toBeUndefined();
  });
});
