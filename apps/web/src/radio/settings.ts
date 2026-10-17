import {
  isFsapiError,
  type ListItem,
  type ListPath,
  type MultipleResult,
  type ScalarPath,
} from "@muga/fsapi-core";
import { LatestWins } from "./latest.ts";
import type {
  ClockSource,
  ClockState,
  EqBand,
  RadioContext,
  SettingsState,
  UpdateCheck,
} from "./types.ts";

/** UNDOK's sleep timer choices, in minutes (`sleep_timer_integer_values_array`). */
export const SLEEP_MINUTES = [15, 30, 45, 60, 90, 120] as const;

/** `sys.info.friendlyName` holds 32 bytes; UNDOK allows 32 characters (24 on Cast radios). */
export const NAME_MAX_BYTES = 32;

// Read in small groups: some embedded web servers limit the URL length.
const DEVICE_NODES = [
  "netRemote.sys.info.modelName",
  "netRemote.sys.info.version",
  "netRemote.sys.info.radioId",
  "netRemote.sys.info.serialNumber",
  "netRemote.sys.net.wlan.connectedSSID",
  "netRemote.sys.net.wlan.rssi",
  "netRemote.sys.net.wlan.macAddress",
  "netRemote.sys.net.wired.interfaceEnable",
  "netRemote.sys.net.wired.macAddress",
] as const satisfies readonly ScalarPath[];

const AUDIO_NODES = [
  "netRemote.sys.sleep",
  "netRemote.sys.audio.eqPreset",
  "netRemote.sys.audio.eqLoudness",
  "netRemote.sys.lang",
  "netRemote.sys.audio.airableQuality",
  "netRemote.sys.audio.quality",
] as const satisfies readonly ScalarPath[];

const CLOCK_NODES = [
  "netRemote.sys.clock.mode",
  "netRemote.sys.clock.source",
  "netRemote.sys.clock.utcOffset",
  "netRemote.sys.clock.dst",
  "netRemote.sys.clock.timeZone",
  "netRemote.sys.clock.localDate",
  "netRemote.sys.clock.localTime",
] as const satisfies readonly ScalarPath[];

/** What the radio knows about software updates (doc 06 §1.1). */
const UPDATE_NODES = [
  "netRemote.sys.isu.state",
  "netRemote.sys.isu.version",
  "netRemote.sys.isu.mandatory",
  "netRemote.sys.isu.summary",
  "netRemote.sys.isu.softwareUpdateProgress",
] as const satisfies readonly ScalarPath[];

/** Custom EQ band values; only bands 0–4 have nodes (doc 06 §3.2). */
const EQ_PARAMS = [
  "netRemote.sys.audio.eqCustom.param0",
  "netRemote.sys.audio.eqCustom.param1",
  "netRemote.sys.audio.eqCustom.param2",
  "netRemote.sys.audio.eqCustom.param3",
  "netRemote.sys.audio.eqCustom.param4",
] as const satisfies readonly ScalarPath[];

type AudioValues = MultipleResult<(typeof AUDIO_NODES)[number]>["values"];
type ClockValues = MultipleResult<(typeof CLOCK_NODES)[number]>["values"];
type EqParam = (typeof EQ_PARAMS)[number];

/** `sys.caps.clockSourceList` names sources by string (doc 03 §5). */
const CLOCK_SOURCES: Record<string, ClockSource> = {
  DAB: "DAB",
  FM: "FM",
  NETWORK: "SNTP",
  SNTP: "SNTP",
  NO_UPDATE: "MANUAL",
};

export function initialSettings(): SettingsState {
  return {
    status: "idle",
    device: undefined,
    sleep: undefined,
    eq: undefined,
    clock: undefined,
    language: undefined,
    quality: undefined,
    update: undefined,
  };
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The radio's clock (`YYYYMMDD`, `HHMMSS`) as a local Date, moved on by the time since it was read. */
export function radioTime(clock: ClockState, now: number): Date | undefined {
  const date = clock.date.replace(/\D/g, "");
  const time = clock.time.replace(/\D/g, "");
  if (date.length !== 8 || time.length < 4) return undefined;
  const value = new Date(
    Number(date.slice(0, 4)),
    Number(date.slice(4, 6)) - 1,
    Number(date.slice(6, 8)),
    Number(time.slice(0, 2)),
    Number(time.slice(2, 4)),
    Number(time.slice(4, 6) || 0),
  );
  if (Number.isNaN(value.getTime())) return undefined;
  return new Date(value.getTime() + Math.max(0, now - clock.readAt));
}

/**
 * The selected network time zone: by its label when the radio stores one, else by offset. An
 * ICD2018 leaves `sys.clock.timeZone` empty and has unlabelled half-hour zones.
 */
export function currentZone(clock: ClockState): ClockState["zones"][number] | undefined {
  const byLabel = clock.timeZone ? clock.zones.find((z) => z.region === clock.timeZone) : undefined;
  return byLabel ?? clock.zones.find((z) => z.offset === clock.utcOffset);
}

/** `UTC+05:30`, `UTC−11:00` */
export function formatUtcOffset(seconds: number): string {
  const sign = seconds < 0 ? "\u2212" : "+";
  const minutes = Math.round(Math.abs(seconds) / 60);
  return `UTC${sign}${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** A zone as the radio labels it, with its offset in front unless the label already has one. */
export function zoneLabel(zone: ClockState["zones"][number]): string {
  const offset = formatUtcOffset(zone.offset);
  if (!zone.region) return offset;
  return /^(UTC|GMT)/i.test(zone.region) ? zone.region : `${offset} · ${zone.region}`;
}

/** Settings and device information (doc 06 §3). Sections exist only where the radio has the nodes. */
export class SettingsManager {
  private readonly bandWriters = new Map<number, LatestWins<number>>();
  /** A load in progress; repeated calls share it. */
  private loading: Promise<void> | undefined;

  constructor(private readonly ctx: RadioContext) {}

  private get state(): SettingsState {
    return this.ctx.snapshot().settings;
  }

  private set(patch: Partial<SettingsState>): void {
    this.ctx.update({ settings: { ...this.state, ...patch } });
  }

  /** Reads everything once. Only reads: UNDOK's write probes (e.g. `sys.audio.quality=100`) are avoided. */
  load(): Promise<void> {
    this.loading ??= this.read().finally(() => {
      this.loading = undefined;
    });
    return this.loading;
  }

  /**
   * What the radio found the last time it checked for software updates by itself. Read only:
   * asking it to check (`sys.isu.control`) makes it contact its update server, which is left for
   * later (ADR 0007).
   */
  async checkUpdate(): Promise<void> {
    this.set({ update: { status: "checking" } });
    let update: UpdateCheck;
    try {
      const { values } = await this.ctx.client.getMultiple(UPDATE_NODES);
      const state = values["netRemote.sys.isu.state"];
      const version = values["netRemote.sys.isu.version"]?.trim() ?? "";
      const progress = values["netRemote.sys.isu.softwareUpdateProgress"] ?? 0;
      if (progress > 0) update = { status: "updating", progress };
      else if (state === "UPDATE_AVAILABLE" && version) {
        update = {
          status: "available",
          version,
          important: values["netRemote.sys.isu.mandatory"] === "YES",
          summary: values["netRemote.sys.isu.summary"]?.trim() ?? "",
        };
      } else {
        const known = {
          IDLE: "notChecked",
          CHECK_IN_PROGRESS: "inProgress",
          UPDATE_AVAILABLE: "none",
          UPDATE_NOT_AVAILABLE: "none",
          CHECK_FAILED: "failed",
        } as const;
        // An unknown number is a state this catalog doesn't name.
        update = {
          status:
            state === undefined
              ? "unsupported"
              : typeof state === "string"
                ? known[state]
                : "error",
        };
      }
    } catch {
      update = { status: "error" };
    }
    this.set({ update });
  }

  private async read(): Promise<void> {
    const { client } = this.ctx;
    this.set({ status: "loading", update: undefined });
    try {
      const device = (await client.getMultiple(DEVICE_NODES)).values;
      const audio = (await client.getMultiple(AUDIO_NODES)).values;
      const clock = (await client.getMultiple(CLOCK_NODES)).values;

      const wired = device["netRemote.sys.net.wired.interfaceEnable"] === "INTERFACE_ENABLE";
      const ssid = device["netRemote.sys.net.wlan.connectedSSID"]?.trim() ?? "";
      const rssi = device["netRemote.sys.net.wlan.rssi"];
      const sleep = audio["netRemote.sys.sleep"];

      this.set({
        status: "ready",
        device: {
          model: device["netRemote.sys.info.modelName"]?.trim() ?? "",
          version: device["netRemote.sys.info.version"]?.trim() ?? "",
          radioId: device["netRemote.sys.info.radioId"]?.trim() ?? "",
          serial: device["netRemote.sys.info.serialNumber"]?.trim() ?? "",
          network: wired ? "ethernet" : ssid || rssi !== undefined ? "wifi" : undefined,
          ssid,
          signal: wired ? undefined : rssi,
          mac:
            (wired
              ? device["netRemote.sys.net.wired.macAddress"]
              : device["netRemote.sys.net.wlan.macAddress"]
            )?.trim() ?? "",
        },
        sleep: sleep === undefined ? undefined : { remaining: sleep, readAt: this.ctx.now() },
        eq: await this.readEq(
          audio["netRemote.sys.audio.eqPreset"],
          audio["netRemote.sys.audio.eqLoudness"],
        ),
        language: await this.readLanguages(audio["netRemote.sys.lang"]),
        quality: this.quality(audio),
        clock: await this.readClock(clock),
      });
    } catch (error) {
      this.set({ status: "error" });
      this.ctx.fail("settings", error);
    }
  }

  // Name

  rename(name: string): Promise<boolean> {
    const trimmed = name.trim();
    if (!trimmed) return Promise.resolve(false);
    return this.ctx.run("rename", async () => {
      await this.ctx.client.set("netRemote.sys.info.friendlyName", trimmed);
      this.ctx.update({ name: trimmed });
    });
  }

  // Sleep timer

  /** 0 cancels the timer. */
  setSleep(minutes: number): Promise<boolean> {
    return this.ctx.run("sleep", async () => {
      await this.ctx.client.set("netRemote.sys.sleep", minutes * 60);
      this.set({ sleep: { remaining: minutes * 60, readAt: this.ctx.now() } });
    });
  }

  /** The radio counts down; read it again to stay in step. */
  async refreshSleep(): Promise<void> {
    if (!this.state.sleep) return;
    const remaining = await this.ctx.client.get("netRemote.sys.sleep").catch(() => undefined);
    if (remaining !== undefined) this.set({ sleep: { remaining, readAt: this.ctx.now() } });
  }

  // Equalizer

  selectEq(key: number): Promise<boolean> {
    return this.ctx.run("eq", async () => {
      await this.ctx.client.set("netRemote.sys.audio.eqPreset", key);
      const eq = this.state.eq;
      if (eq) this.set({ eq: { ...eq, current: key } });
    });
  }

  /** Custom EQ band; latest value wins while a slider moves. */
  setEqBand(key: number, value: number): Promise<boolean> {
    const node = EQ_PARAMS[key];
    const eq = this.state.eq;
    if (!node || !eq) return Promise.resolve(false);
    this.set({ eq: { ...eq, bands: eq.bands.map((b) => (b.key === key ? { ...b, value } : b)) } });
    let writer = this.bandWriters.get(key);
    if (!writer) {
      writer = new LatestWins((v) => this.ctx.client.set(node, v), {
        onError: (error) => this.ctx.fail("eq", error),
      });
      this.bandWriters.set(key, writer);
    }
    return writer.push(value);
  }

  setLoudness(on: boolean): Promise<boolean> {
    return this.ctx.run("eq", async () => {
      await this.ctx.client.set("netRemote.sys.audio.eqLoudness", on ? "ON" : "OFF");
      const eq = this.state.eq;
      if (eq) this.set({ eq: { ...eq, loudness: on } });
    });
  }

  // Language

  /** The radio's own menu language. Source names are localised, so they're read again. */
  setLanguage(key: number): Promise<boolean> {
    return this.ctx.run("language", async () => {
      await this.ctx.client.set("netRemote.sys.lang", key);
      const language = this.state.language;
      if (language) this.set({ language: { ...language, current: key } });
      this.ctx.refreshInfo();
    });
  }

  // Streaming quality

  setQuality(value: "LOW" | "NORMAL" | "HIGH"): Promise<boolean> {
    const quality = this.state.quality;
    if (!quality) return Promise.resolve(false);
    return this.ctx.run("quality", async () => {
      await this.ctx.client.set(quality.node, value);
      this.set({ quality: { ...quality, value } });
    });
  }

  // Clock

  setClockFormat(format: "12" | "24"): Promise<boolean> {
    return this.clockStep(async () => {
      await this.ctx.client.set(
        "netRemote.sys.clock.mode",
        format === "12" ? "_12_HOUR" : "_24_HOUR",
      );
      return { format };
    });
  }

  setClockSource(source: ClockSource): Promise<boolean> {
    return this.clockStep(async () => {
      await this.ctx.client.set("netRemote.sys.clock.source", source);
      return { source };
    });
  }

  /**
   * Network time zone: UNDOK writes the offset, then the region label (doc 06 §3.4). The label
   * is skipped on radios without `sys.clock.timeZone`; the offset alone moves the clock there.
   */
  setTimeZone(key: number): Promise<boolean> {
    const clock = this.state.clock;
    const zone = clock?.zones.find((z) => z.key === key);
    if (!zone) return Promise.resolve(false);
    const withLabel = clock?.timeZone !== undefined;
    return this.clockStep(async () => {
      await this.ctx.client.set("netRemote.sys.clock.utcOffset", zone.offset);
      if (withLabel) await this.ctx.client.set("netRemote.sys.clock.timeZone", zone.region);
      return { utcOffset: zone.offset, ...(withLabel ? { timeZone: zone.region } : {}) };
    });
  }

  setDst(on: boolean): Promise<boolean> {
    return this.clockStep(async () => {
      await this.ctx.client.set("netRemote.sys.clock.dst", on ? "ON" : "OFF");
      return { dst: on };
    });
  }

  /** Manual clock: date and time to the minute, as UNDOK sends them (seconds `00`). */
  setDateTime(value: Date): Promise<boolean> {
    const date = `${value.getFullYear()}${pad(value.getMonth() + 1)}${pad(value.getDate())}`;
    const time = `${pad(value.getHours())}${pad(value.getMinutes())}00`;
    return this.clockStep(async () => {
      await this.ctx.client.set("netRemote.sys.clock.localDate", date);
      await this.ctx.client.set("netRemote.sys.clock.localTime", time);
      return { date, time, readAt: this.ctx.now() };
    });
  }

  /**
   * Runs one clock change, then reads the radio's time again: zone, DST and source move it. An
   * ICD2018 applies `utcOffset` a moment after answering FS_OK, so wait before reading.
   */
  private clockStep(task: () => Promise<Partial<ClockState>>): Promise<boolean> {
    return this.ctx.run("clock", async () => {
      const patch = await task();
      await sleep(this.ctx.nav.pollMs ?? 500);
      const { values } = await this.ctx.client.getMultiple([
        "netRemote.sys.clock.localDate",
        "netRemote.sys.clock.localTime",
      ]);
      const date = values["netRemote.sys.clock.localDate"];
      const time = values["netRemote.sys.clock.localTime"];
      const clock = this.state.clock;
      if (!clock) return;
      this.set({
        clock: {
          ...clock,
          ...patch,
          ...(date && time ? { date, time, readAt: this.ctx.now() } : {}),
        },
      });
    });
  }

  // Reading

  private async list<P extends ListPath>(path: P): Promise<ListItem<P>[] | undefined> {
    try {
      return await this.ctx.client.listAllItems(path, { pageSize: 30 });
    } catch (error) {
      if (isFsapiError(error, "status")) return undefined;
      throw error;
    }
  }

  private async readEq(
    current: number | undefined,
    loudness: string | number | undefined,
  ): Promise<SettingsState["eq"]> {
    const presets = await this.list("netRemote.sys.caps.eqPresets");
    if (!presets?.length) return undefined;
    const bands = (await this.list("netRemote.sys.caps.eqBands")) ?? [];
    const supported = bands.flatMap((b) => {
      const node: EqParam | undefined = EQ_PARAMS[b.key];
      return node ? [{ band: b, node }] : [];
    });
    const values: MultipleResult<EqParam>["values"] = supported.length
      ? (await this.ctx.client.getMultiple(supported.map((s) => s.node))).values
      : {};
    return {
      presets: presets.map((p) => ({ key: p.key, label: p.label.trim() })),
      current,
      bands: supported.map(
        ({ band, node }): EqBand => ({
          key: band.key,
          label: band.label.trim(),
          min: band.min,
          max: band.max,
          value: values[node],
        }),
      ),
      loudness: loudness === undefined ? undefined : loudness === "ON",
    };
  }

  /** UNDOK hides the menu when the radio only offers a test language (doc 06 §2.4). */
  private async readLanguages(current: number | undefined): Promise<SettingsState["language"]> {
    const options = (await this.list("netRemote.sys.caps.validLang"))?.map((l) => ({
      key: l.key,
      label: l.langLabel.trim(),
    }));
    if (!options?.length) return undefined;
    if (options.length === 2 && options.some((o) => o.label === "Testlang")) return undefined;
    return { current, options };
  }

  /** Only for radios with streaming services, as UNDOK. */
  private quality(values: AudioValues): SettingsState["quality"] {
    const streaming = this.ctx
      .snapshot()
      .modes.some((m) => m.id === "IR" || m.id === "Spotify" || m.id.startsWith("AIRABLE"));
    if (!streaming) return undefined;
    for (const node of [
      "netRemote.sys.audio.airableQuality",
      "netRemote.sys.audio.quality",
    ] as const) {
      const value = values[node];
      if (value === "LOW" || value === "NORMAL" || value === "HIGH") return { node, value };
    }
    return undefined;
  }

  private async readClock(values: ClockValues): Promise<ClockState | undefined> {
    const list = await this.list("netRemote.sys.caps.clockSourceList");
    if (!list) return undefined;
    const sources = [
      ...new Set(list.flatMap((s) => CLOCK_SOURCES[s.source.trim().toUpperCase()] ?? [])),
    ];
    const zones = (await this.list("netRemote.sys.caps.utcSettingsList")) ?? [];
    const mode = values["netRemote.sys.clock.mode"];
    const source = values["netRemote.sys.clock.source"];
    const dst = values["netRemote.sys.clock.dst"];
    return {
      format: mode === "_12_HOUR" ? "12" : mode === "_24_HOUR" ? "24" : undefined,
      source: typeof source === "string" ? source : undefined,
      sources,
      utcOffset: values["netRemote.sys.clock.utcOffset"],
      dst: dst === undefined ? undefined : dst === "ON",
      timeZone: values["netRemote.sys.clock.timeZone"]?.trim(),
      zones: zones.map((z) => ({ key: z.key, offset: z.time, region: z.region.trim() })),
      date: values["netRemote.sys.clock.localDate"] ?? "",
      time: values["netRemote.sys.clock.localTime"] ?? "",
      readAt: this.ctx.now(),
    };
  }
}
