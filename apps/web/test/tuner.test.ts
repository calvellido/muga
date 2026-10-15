import { describe, expect, it } from "vitest";
import { snapFrequency } from "../src/radio/tuner.ts";
import { simulatedRadio } from "./support.ts";

const setup = simulatedRadio();
const FM = 4;

async function onFm() {
  const radio = await setup();
  await radio.controller.setMode(FM);
  await radio.controller.refreshNow();
  return radio;
}

describe("FmTuner", () => {
  it("snaps to the band's step grid and clamps to the band", () => {
    const band = { lower: 87_500, upper: 108_000, step: 50, frequency: undefined };
    expect(snapFrequency(99_123, band)).toBe(99_100);
    expect(snapFrequency(99_130, band)).toBe(99_150);
    expect(snapFrequency(80_000, band)).toBe(87_500);
    expect(snapFrequency(120_000, band)).toBe(108_000);
  });

  it("reads the band and frequency once the radio is on FM", async () => {
    const { controller } = await onFm();
    expect(controller.getSnapshot().tuner).toEqual({
      lower: 87_500,
      upper: 108_000,
      step: 50,
      frequency: 93_200,
    });
  });

  it("steps and tunes, snapping what it sends", async () => {
    const { sim, controller } = await onFm();
    await controller.tuner.step(1);
    expect(sim.get("netRemote.play.frequency")).toBe(93_250);
    await controller.tuner.tune(99_123);
    expect(sim.get("netRemote.play.frequency")).toBe(99_100);
    await controller.refreshNow();
    expect(controller.getSnapshot().play.name).toBe("Harbour");
  });

  it("sends only the latest frequency while the dial is dragged", async () => {
    const { sim, controller } = await onFm();
    const results = [88_000, 90_000, 92_000, 94_000, 96_000].map((f) => controller.tuner.tune(f));
    expect(controller.getSnapshot().tuner?.frequency).toBe(96_000);
    await Promise.all(results);
    expect(sim.get("netRemote.play.frequency")).toBe(96_000);
    const sets = sim.requests.filter(
      (r) => r.verb === "SET" && r.node === "netRemote.play.frequency",
    );
    expect(sets.length).toBeLessThan(5);
  });

  it("follows a frequency changed by seeking", async () => {
    let now = 0;
    const { controller } = await setup({ controller: { now: () => now } });
    await controller.setMode(FM);
    await controller.refreshNow();
    await controller.control("NEXT");
    now += 10_000;
    await controller.refreshNow();
    expect(controller.getSnapshot().tuner?.frequency).toBe(99_100);
  });
});
