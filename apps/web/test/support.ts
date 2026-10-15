import { type RadioSimulator, type SimulatorOptions, startSimulator } from "@muga/fsapi-sim";
import { afterEach } from "vitest";
import { RadioController, type RadioControllerOptions } from "../src/radio/controller.ts";

/**
 * A controller connected to a fresh simulator per test. Polling timers are long; tests drive
 * polls explicitly with refreshNow().
 */
export function simulatedRadio() {
  let sim: RadioSimulator | undefined;
  let controller: RadioController | undefined;

  afterEach(async () => {
    controller?.stop();
    await sim?.close();
    sim = undefined;
    controller = undefined;
  });

  return async (options: { sim?: SimulatorOptions; controller?: RadioControllerOptions } = {}) => {
    sim = await startSimulator(options.sim);
    controller = new RadioController(
      { id: "sim", host: sim.host, pin: "1234", name: "Sim" },
      {
        activeIntervalMs: 60_000,
        backgroundIntervalMs: 60_000,
        navPollMs: 5,
        ...options.controller,
      },
    );
    controller.start(true);
    await controller.refreshNow();
    return { sim, controller };
  };
}
