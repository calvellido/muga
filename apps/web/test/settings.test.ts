import { describe, expect, it } from "vitest";
import { currentZone, radioTime, zoneLabel } from "../src/radio/settings.ts";
import { simulatedRadio } from "./support.ts";

const setup = simulatedRadio();

async function loaded(options: Parameters<typeof setup>[0] = {}) {
  const radio = await setup(options);
  await radio.controller.settings.load();
  return radio;
}

const settingsOf = (radio: Awaited<ReturnType<typeof loaded>>) =>
  radio.controller.getSnapshot().settings;

describe("clock helpers", () => {
  const zones = [
    { key: 0, offset: -41_400, region: "" },
    { key: 1, offset: 3_600, region: "Madrid, Paris" },
    { key: 2, offset: 0, region: "UTC+00:00: London" },
  ];
  const clock = {
    format: "24" as const,
    source: "SNTP" as const,
    sources: [],
    dst: true,
    zones,
    date: "",
    time: "",
    readAt: 0,
  };

  it("labels zones as an ICD2018 lists them: some unlabelled, without offsets", () => {
    expect(zones.map(zoneLabel)).toEqual([
      "UTC\u221211:30",
      "UTC+01:00 · Madrid, Paris",
      "UTC+00:00: London",
    ]);
  });

  it("finds the current zone by label, or by offset when the radio stores no label", () => {
    expect(currentZone({ ...clock, utcOffset: 3_600, timeZone: "" })?.key).toBe(1);
    expect(currentZone({ ...clock, utcOffset: 3_600, timeZone: "UTC+00:00: London" })?.key).toBe(2);
  });

  it("never runs the radio's clock backwards", () => {
    const c = {
      ...clock,
      utcOffset: 0,
      timeZone: "",
      date: "20261015",
      time: "093000",
      readAt: 1_000,
    };
    expect(radioTime(c, 500)?.getMinutes()).toBe(30);
  });
});

describe("SettingsManager", () => {
  it("reads device information, with the Wi-Fi name decoded", async () => {
    const radio = await loaded();
    expect(settingsOf(radio)).toMatchObject({
      status: "ready",
      device: {
        model: "Muga Sim",
        radioId: "002261000000",
        serial: "SIM0000001",
        network: "wifi",
        ssid: "MugaNet",
        signal: 60,
        mac: "00:22:61:00:00:00",
      },
    });
  });

  it("shows the wired MAC address when Ethernet is in use", async () => {
    const radio = await loaded({
      sim: {
        profile: { values: { "netRemote.sys.net.wired.interfaceEnable": "INTERFACE_ENABLE" } },
      },
    });
    expect(settingsOf(radio).device).toMatchObject({
      network: "ethernet",
      mac: "00:22:61:00:00:01",
      signal: undefined,
    });
  });

  it("renames the speaker", async () => {
    const { sim, controller } = await loaded();
    expect(await controller.settings.rename("  Kitchen  ")).toBe(true);
    expect(sim.get("netRemote.sys.info.friendlyName")).toBe("Kitchen");
    expect(controller.getSnapshot().name).toBe("Kitchen");
    // 33 bytes doesn't fit the radio's 32-byte name; nothing is sent.
    expect(await controller.settings.rename("x".repeat(33))).toBe(false);
    expect(sim.get("netRemote.sys.info.friendlyName")).toBe("Kitchen");
  });

  it("sets and cancels the sleep timer in seconds", async () => {
    const { sim, controller } = await loaded();
    await controller.settings.setSleep(30);
    expect(Number(sim.get("netRemote.sys.sleep"))).toBeGreaterThan(1_790);
    await controller.settings.refreshSleep();
    expect(controller.getSnapshot().settings.sleep?.remaining).toBeLessThanOrEqual(1_800);
    await controller.settings.setSleep(0);
    expect(sim.get("netRemote.sys.sleep")).toBe(0);
  });

  it("selects EQ presets and adjusts the custom bands", async () => {
    const radio = await loaded();
    const { sim, controller } = radio;
    const eq = settingsOf(radio).eq;
    expect(eq?.presets.map((p) => p.label).slice(0, 3)).toEqual(["My EQ", "Normal", "Flat"]);
    expect(eq?.current).toBe(1);
    expect(eq?.bands.map((b) => [b.label, b.min, b.max, b.value])).toEqual([
      ["Bass", -7, 7, 0],
      ["Treble", -7, 7, 0],
    ]);
    expect(eq?.loudness).toBe(false);

    await controller.settings.selectEq(0);
    expect(sim.get("netRemote.sys.audio.eqPreset")).toBe(0);
    await Promise.all([3, 4, 5].map((v) => controller.settings.setEqBand(1, v)));
    expect(sim.get("netRemote.sys.audio.eqCustom.param1")).toBe(5);
    await controller.settings.setEqBand(0, -2);
    expect(sim.get("netRemote.sys.audio.eqCustom.param0")).toBe(-2);
    await controller.settings.setLoudness(true);
    expect(sim.get("netRemote.sys.audio.eqLoudness")).toBe(1);
  });

  it("changes the radio's language and re-reads the source names", async () => {
    const radio = await loaded();
    const { sim, controller } = radio;
    expect(settingsOf(radio).language?.options.map((o) => o.label)).toContain("Español");
    sim.setList(
      "netRemote.sys.caps.validModes",
      sim
        .list("netRemote.sys.caps.validModes")
        .map((m) => (m.id === "IR" ? { ...m, label: "Radio por Internet" } : m)),
    );
    await controller.settings.setLanguage(2);
    expect(sim.get("netRemote.sys.lang")).toBe(2);
    await controller.refreshNow();
    expect(controller.getSnapshot().modes[0]?.label).toBe("Radio por Internet");
  });

  it("sets the streaming quality on the node the radio has", async () => {
    const radio = await loaded();
    expect(settingsOf(radio).quality).toEqual({
      node: "netRemote.sys.audio.airableQuality",
      value: "NORMAL",
    });
    await radio.controller.settings.setQuality("HIGH");
    expect(radio.sim.get("netRemote.sys.audio.airableQuality")).toBe(2);
  });

  it("reads the clock and changes format, source, zone, DST and manual time", async () => {
    const radio = await loaded();
    const { sim, controller } = radio;
    const clock = settingsOf(radio).clock;
    expect(clock).toMatchObject({
      format: "24",
      source: "SNTP",
      sources: ["SNTP", "DAB", "FM", "MANUAL"],
      utcOffset: 3600,
      dst: true,
      timeZone: "UTC+01:00: Madrid, Paris, Berlin",
    });
    expect(clock && radioTime(clock, clock.readAt)?.getHours()).toBe(9);

    await controller.settings.setClockFormat("12");
    expect(sim.get("netRemote.sys.clock.mode")).toBe(0);
    await controller.settings.setTimeZone(3);
    expect(sim.get("netRemote.sys.clock.utcOffset")).toBe(-18000);
    expect(sim.get("netRemote.sys.clock.timeZone")).toBe("UTC-05:00: New York, Toronto");
    await controller.settings.setDst(false);
    expect(sim.get("netRemote.sys.clock.dst")).toBe(0);
    await controller.settings.setClockSource("MANUAL");
    expect(sim.get("netRemote.sys.clock.source")).toBe(0);
    await controller.settings.setDateTime(new Date(2026, 9, 15, 14, 7, 42));
    expect(sim.get("netRemote.sys.clock.localDate")).toBe("20261015");
    expect(sim.get("netRemote.sys.clock.localTime")).toBe("140700");
  });

  it("changes the zone by offset alone where the radio has no zone label", async () => {
    const radio = await loaded({
      sim: { profile: { missingNodes: ["netRemote.sys.clock.timeZone"] } },
    });
    expect(settingsOf(radio).clock?.timeZone).toBeUndefined();
    expect(await radio.controller.settings.setTimeZone(2)).toBe(true);
    expect(radio.sim.get("netRemote.sys.clock.utcOffset")).toBe(7200);
    expect(radio.controller.getSnapshot().lastError).toBeUndefined();
  });

  it("leaves out what the radio doesn't have", async () => {
    const radio = await loaded({
      sim: {
        profile: {
          missingNodes: [
            "netRemote.sys.sleep",
            "netRemote.sys.caps.eqPresets",
            "netRemote.sys.caps.clockSourceList",
            "netRemote.sys.audio.airableQuality",
            "netRemote.sys.audio.quality",
          ],
          lists: {
            "netRemote.sys.caps.validLang": [
              { key: 0, langLabel: "English" },
              { key: 1, langLabel: "Testlang" },
            ],
          },
        },
      },
    });
    expect(settingsOf(radio)).toMatchObject({
      status: "ready",
      sleep: undefined,
      eq: undefined,
      clock: undefined,
      quality: undefined,
      language: undefined,
    });
  });
});

describe("software updates", () => {
  it("reads what the radio found at its last check, without asking it to check", async () => {
    const radio = await loaded();
    const check = async () => {
      await radio.controller.settings.checkUpdate();
      return settingsOf(radio).update;
    };
    expect(await check()).toEqual({ status: "notChecked" });

    radio.sim.set("netRemote.sys.isu.state", 3);
    expect(await check()).toEqual({ status: "none" });

    radio.sim.set("netRemote.sys.isu.state", 2);
    radio.sim.set("netRemote.sys.isu.version", "V2.14.40");
    radio.sim.set("netRemote.sys.isu.mandatory", 1);
    radio.sim.set("netRemote.sys.isu.summary", "Bug fixes");
    expect(await check()).toEqual({
      status: "available",
      version: "V2.14.40",
      important: true,
      summary: "Bug fixes",
    });

    radio.sim.set("netRemote.sys.isu.softwareUpdateProgress", 40);
    expect(await check()).toEqual({ status: "updating", progress: 40 });

    radio.sim.set("netRemote.sys.isu.softwareUpdateProgress", 0);
    radio.sim.set("netRemote.sys.isu.state", 4);
    expect(await check()).toEqual({ status: "failed" });
    // Never asked to check (CHECK_FOR_UPDATE) or to update.
    expect(radio.sim.get("netRemote.sys.isu.control")).toBe(0);
  });

  it("says when the radio doesn't report updates", async () => {
    const radio = await loaded({ sim: { profile: { missingNodes: ["netRemote.sys.isu.state"] } } });
    await radio.controller.settings.checkUpdate();
    expect(settingsOf(radio).update).toEqual({ status: "unsupported" });
  });
});
