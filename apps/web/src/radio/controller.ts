import {
  type FetchLike,
  FsapiClient,
  isFsapiError,
  type NavOptions,
  type ScalarPath,
} from "@muga/fsapi-core";
import { BrowseSession, initialBrowse } from "./browse.ts";
import { hasCap, PlayCap } from "./caps.ts";
import { PresetManager } from "./presets.ts";
import type {
  ActionError,
  PlayAction,
  PlayState,
  RadioConfig,
  RadioContext,
  RadioSnapshot,
  RepeatMode,
  SourceMode,
} from "./types.ts";

const INFO_NODES = [
  "netRemote.sys.info.friendlyName",
  "netRemote.sys.info.version",
  "netRemote.sys.info.modelName",
  "netRemote.sys.caps.volumeSteps",
  "netRemote.nav.caps",
] as const satisfies readonly ScalarPath[];

/** Read every active poll. */
const FAST_NODES = [
  "netRemote.sys.power",
  "netRemote.sys.mode",
  "netRemote.sys.audio.volume",
  "netRemote.sys.audio.mute",
  "netRemote.play.status",
  "netRemote.play.info.name",
  "netRemote.play.info.text",
] as const satisfies readonly ScalarPath[];

/** Read when the track changes (and every few polls), like UNDOK's notification-driven refresh. */
const TRACK_NODES = [
  "netRemote.play.info.artist",
  "netRemote.play.info.album",
  "netRemote.play.info.graphicUri",
  "netRemote.play.info.duration",
  "netRemote.play.position",
  "netRemote.play.caps",
  "netRemote.play.shuffle",
  "netRemote.play.repeat",
  "netRemote.nav.preset.currentPreset",
  // Per source: whether it can be browsed and has (editable) presets.
  "netRemote.nav.caps",
] as const satisfies readonly ScalarPath[];

/** Read for radios that aren't selected, for the speaker list. */
const BACKGROUND_NODES = [
  "netRemote.sys.power",
  "netRemote.sys.mode",
  "netRemote.sys.audio.volume",
  "netRemote.play.status",
  "netRemote.play.info.name",
] as const satisfies readonly ScalarPath[];

const DEFAULT_VOLUME_STEPS = 32;
const OPTIMISTIC_STATUS: Record<PlayAction, PlayState["status"]> = {
  PLAY: "PLAYING",
  PAUSE: "PAUSED",
  STOP: "STOPPED",
  NEXT: undefined,
  PREVIOUS: undefined,
};
const PLAYING = new Set<unknown>(["PLAYING", "BUFFERING", "REBUFFERING"]);

export interface RadioControllerOptions {
  fetch?: FetchLike;
  /** Poll interval for the selected radio. Default 2000 ms. */
  activeIntervalMs?: number;
  /** Poll interval for the other radios. Default 15000 ms. */
  backgroundIntervalMs?: number;
  /** Re-read track details every N active polls even when nothing changed. Default 5. */
  trackRefreshEvery?: number;
  navPollMs?: number;
  navTimeoutMs?: number;
  now?: () => number;
}

function emptyPlay(): PlayState {
  return {
    status: undefined,
    name: "",
    text: "",
    artist: "",
    album: "",
    artworkUrl: "",
    durationMs: 0,
    positionMs: 0,
    positionAt: 0,
    caps: 0,
    shuffle: false,
    repeat: "OFF",
  };
}

export function initialSnapshot(config: RadioConfig): RadioSnapshot {
  return {
    config,
    connection: "connecting",
    name: config.name,
    version: "",
    model: "",
    volumeSteps: DEFAULT_VOLUME_STEPS,
    power: undefined,
    modeKey: undefined,
    modes: [],
    volume: undefined,
    muted: false,
    play: emptyPlay(),
    navCaps: undefined,
    currentPreset: undefined,
    presets: { status: "idle", items: [] },
    browse: initialBrowse(),
    lastError: undefined,
  };
}

export function isPlaying(status: unknown): boolean {
  return PLAYING.has(status);
}

/** Larger artwork where the service supports it (UNDOK does the same, doc 05 §2.1). */
function artwork(uri: string | undefined): string {
  return (uri ?? "").trim().replace("150x150", "500x500");
}

/** Some radios leave the FM frequency as the name after switching away from FM (doc 05 §2.1). */
function stationName(name: string | undefined, modeId: string | number | undefined): string {
  const trimmed = (name ?? "").trim();
  return modeId !== "FM" && /MHz$/i.test(trimmed) ? "" : trimmed;
}

function asRepeat(value: unknown): RepeatMode {
  return value === "REPEAT_ALL" || value === "REPEAT_ONE" ? value : "OFF";
}

export class RadioController {
  /** Preset list of the current source. */
  readonly presets: PresetManager;
  /** Menu browsing of the current source. */
  readonly browse: BrowseSession;

  private snapshot: RadioSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly client: FsapiClient;
  private readonly opts: Required<Omit<RadioControllerOptions, "fetch">>;

  private running = false;
  private active = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private currentPoll: Promise<void> | undefined;
  private pollAgain = false;
  private failures = 0;
  private infoLoaded = false;
  private tick = 0;
  private lastTrackKey = "";

  private volumeNext: number | undefined;
  private volumeLoop: Promise<boolean> | undefined;
  private volumeSettleUntil = 0;

  constructor(config: RadioConfig, options: RadioControllerOptions = {}) {
    this.snapshot = initialSnapshot(config);
    this.client = new FsapiClient({
      host: config.host,
      pin: config.pin,
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
    this.opts = {
      activeIntervalMs: options.activeIntervalMs ?? 2_000,
      backgroundIntervalMs: options.backgroundIntervalMs ?? 15_000,
      trackRefreshEvery: options.trackRefreshEvery ?? 5,
      navPollMs: options.navPollMs ?? 500,
      navTimeoutMs: options.navTimeoutMs ?? 30_000,
      now: options.now ?? Date.now,
    };
    const nav: NavOptions = { pollMs: this.opts.navPollMs, timeoutMs: this.opts.navTimeoutMs };
    const context: RadioContext = {
      client: this.client,
      nav,
      snapshot: () => this.snapshot,
      update: (patch) => this.update(patch),
      run: (action, task) => this.run(action, task),
      fail: (action, error) => this.fail(action, error),
      playbackChanged: () => {
        this.lastTrackKey = "";
        this.schedule(300);
      },
    };
    this.presets = new PresetManager(context);
    this.browse = new BrowseSession(context);
  }

  // Store interface (for useSyncExternalStore)

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): RadioSnapshot => this.snapshot;

  // Lifecycle

  start(active = false): void {
    this.active = active;
    if (this.running) return;
    this.running = true;
    this.schedule(0);
  }

  stop(): void {
    this.running = false;
    clearTimeout(this.timer);
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (active) {
      this.lastTrackKey = "";
      this.schedule(0);
    }
  }

  /** Polls now and resolves when the poll has finished. */
  async refreshNow(): Promise<void> {
    await this.currentPoll;
    await this.poll();
  }

  setPin(pin: string): void {
    this.snapshot = { ...this.snapshot, config: { ...this.snapshot.config, pin } };
    this.client.pin = pin;
    this.update({ connection: "connecting", lastError: undefined });
    this.schedule(0);
  }

  clearError(): void {
    this.update({ lastError: undefined });
  }

  // Actions

  setPower(on: boolean): Promise<boolean> {
    return this.run("power", async () => {
      await this.client.set("netRemote.sys.power", on ? "ON" : "OFF");
      if (!on) this.browse.invalidate();
      this.update({ power: on });
    });
  }

  /** Latest value wins; at most one SET in flight (as UNDOK does, doc 05 §5). */
  setVolume(value: number): Promise<boolean> {
    const max = Math.max(0, this.snapshot.volumeSteps - 1);
    const volume = Math.round(Math.min(max, Math.max(0, value)));
    this.update({ volume });
    this.volumeNext = volume;
    this.volumeSettleUntil = this.opts.now() + 1_500;
    if (this.volumeLoop) return this.volumeLoop;

    this.volumeLoop = (async () => {
      try {
        while (this.volumeNext !== undefined) {
          const next = this.volumeNext;
          this.volumeNext = undefined;
          await this.client.set("netRemote.sys.audio.volume", next);
        }
        return true;
      } catch (error) {
        this.volumeNext = undefined;
        this.fail("volume", error);
        return false;
      } finally {
        this.volumeLoop = undefined;
        this.volumeSettleUntil = this.opts.now() + 800;
      }
    })();
    return this.volumeLoop;
  }

  toggleMute(): Promise<boolean> {
    return this.run("mute", async () => {
      const muted = !this.snapshot.muted;
      await this.client.set("netRemote.sys.audio.mute", muted ? "MUTE" : "NOT_MUTE");
      this.update({ muted });
    });
  }

  control(action: PlayAction): Promise<boolean> {
    return this.run("control", async () => {
      await this.client.set("netRemote.play.control", action);
      const status = OPTIMISTIC_STATUS[action];
      if (status) this.updatePlay({ status });
      this.lastTrackKey = "";
    });
  }

  /** Pause when the source can pause, stop when it can only stop (e.g. live radio), else play. */
  togglePlay(): Promise<boolean> {
    const { status, caps } = this.snapshot.play;
    if (!isPlaying(status)) return this.control("PLAY");
    return this.control(
      hasCap(caps, PlayCap.Pause) || !hasCap(caps, PlayCap.Stop) ? "PAUSE" : "STOP",
    );
  }

  setShuffle(on: boolean): Promise<boolean> {
    return this.run("shuffle", async () => {
      await this.client.set("netRemote.play.shuffle", on ? "ON" : "OFF");
      this.updatePlay({ shuffle: on });
    });
  }

  /** OFF → REPEAT_ALL → REPEAT_ONE (when supported) → OFF. */
  cycleRepeat(): Promise<boolean> {
    const { repeat, caps } = this.snapshot.play;
    const next: RepeatMode =
      repeat === "OFF"
        ? "REPEAT_ALL"
        : repeat === "REPEAT_ALL" && hasCap(caps, PlayCap.RepeatOne)
          ? "REPEAT_ONE"
          : "OFF";
    return this.run("repeat", async () => {
      await this.client.set("netRemote.play.repeat", next);
      this.updatePlay({ repeat: next });
    });
  }

  /** Powers the radio on first when it's in standby (doc 05 §1.2). */
  setMode(key: number): Promise<boolean> {
    return this.run("mode", async () => {
      if (this.snapshot.power === false) {
        await this.client.set("netRemote.sys.power", "ON");
        this.update({ power: true });
      }
      await this.client.set("netRemote.sys.mode", key);
      this.browse.invalidate();
      // nav.caps differs per source; read it again with the track details.
      this.update({ modeKey: key, navCaps: undefined, presets: { status: "idle", items: [] } });
      this.lastTrackKey = "";
    });
  }

  // Polling

  private schedule(delay?: number): void {
    clearTimeout(this.timer);
    if (!this.running || this.snapshot.connection === "pin-required") return;
    const base = this.active ? this.opts.activeIntervalMs : this.opts.backgroundIntervalMs;
    const wait =
      delay ??
      (this.snapshot.connection === "offline" ? Math.min(base * 2 ** this.failures, 30_000) : base);
    this.timer = setTimeout(() => void this.poll(), wait);
  }

  private poll(): Promise<void> {
    if (this.currentPoll) {
      this.pollAgain = true;
      return this.currentPoll;
    }
    this.currentPoll = this.pollOnce().finally(() => {
      this.currentPoll = undefined;
      if (this.pollAgain) {
        this.pollAgain = false;
        this.schedule(0);
      } else {
        this.schedule();
      }
    });
    return this.currentPoll;
  }

  private async pollOnce(): Promise<void> {
    try {
      if (!this.infoLoaded) await this.loadInfo();
      const nodes = this.active ? FAST_NODES : BACKGROUND_NODES;
      const { values } = await this.client.getMultiple(nodes);
      const previousMode = this.snapshot.modeKey;
      const modeKey = values["netRemote.sys.mode"];
      const modeId = this.snapshot.modes.find((m) => m.key === modeKey)?.id;
      const power = values["netRemote.sys.power"];

      const patch: Partial<RadioSnapshot> = { connection: "online" };
      if (power !== undefined) patch.power = power === "ON" || power === 1;
      if (modeKey !== undefined) patch.modeKey = modeKey;
      const volume = values["netRemote.sys.audio.volume"];
      if (volume !== undefined && !this.volumeLoop && this.opts.now() >= this.volumeSettleUntil) {
        patch.volume = volume;
      }
      const mute = values["netRemote.sys.audio.mute"];
      if (mute !== undefined) patch.muted = mute === "MUTE";
      if (modeKey !== undefined && previousMode !== undefined && modeKey !== previousMode) {
        patch.presets = { status: "idle", items: [] };
        patch.navCaps = undefined;
        this.browse.invalidate();
      }
      // The radio forgets the menu position in standby.
      if (patch.power === false && this.snapshot.power !== false) this.browse.invalidate();
      this.update(patch);
      this.updatePlay({
        status: values["netRemote.play.status"],
        name: stationName(values["netRemote.play.info.name"], modeId),
        text: values["netRemote.play.info.text"]?.trim() ?? this.snapshot.play.text,
      });
      this.failures = 0;

      if (this.active) await this.refreshTrack();
    } catch (error) {
      if (isFsapiError(error, "pin")) {
        this.update({ connection: "pin-required" });
      } else if (isFsapiError(error)) {
        this.failures++;
        if (error.kind === "network" || error.kind === "timeout") {
          this.update({ connection: "offline" });
        } else {
          this.fail("poll", error);
        }
      } else {
        this.failures++;
        this.fail("poll", error);
      }
    }
  }

  private async loadInfo(): Promise<void> {
    const { values } = await this.client.getMultiple(INFO_NODES);
    let modes: SourceMode[] = [];
    try {
      const all = await this.client.listAllItems("netRemote.sys.caps.validModes", { pageSize: 30 });
      modes = all.filter((m) => m.selectable !== 0);
    } catch (error) {
      if (!isFsapiError(error, "status")) throw error;
    }
    this.infoLoaded = true;
    const steps = values["netRemote.sys.caps.volumeSteps"];
    this.update({
      name: values["netRemote.sys.info.friendlyName"] || this.snapshot.config.name,
      version: values["netRemote.sys.info.version"] ?? "",
      model: values["netRemote.sys.info.modelName"] ?? "",
      volumeSteps: steps && steps > 0 ? steps : DEFAULT_VOLUME_STEPS,
      navCaps: values["netRemote.nav.caps"],
      modes,
    });
  }

  private async refreshTrack(): Promise<void> {
    const { modeKey, play } = this.snapshot;
    const trackKey = [modeKey, play.name, play.text, play.status].join("|");
    const due = this.tick % this.opts.trackRefreshEvery === 0;
    this.tick++;
    if (trackKey === this.lastTrackKey && !due) return;
    const { values } = await this.client.getMultiple(TRACK_NODES);
    this.lastTrackKey = trackKey;
    const shuffle = values["netRemote.play.shuffle"];
    const position = values["netRemote.play.position"];
    this.updatePlay({
      artist: values["netRemote.play.info.artist"]?.trim() ?? "",
      album: values["netRemote.play.info.album"]?.trim() ?? "",
      artworkUrl: artwork(values["netRemote.play.info.graphicUri"]),
      durationMs: values["netRemote.play.info.duration"] ?? 0,
      ...(position !== undefined ? { positionMs: position, positionAt: this.opts.now() } : {}),
      caps: values["netRemote.play.caps"] ?? 0,
      shuffle: shuffle === "ON" || shuffle === 1,
      repeat: asRepeat(values["netRemote.play.repeat"]),
    });
    this.update({
      currentPreset: values["netRemote.nav.preset.currentPreset"],
      navCaps: values["netRemote.nav.caps"] ?? this.snapshot.navCaps,
    });
  }

  // State helpers

  private async run(action: string, task: () => Promise<void>): Promise<boolean> {
    try {
      await task();
      return true;
    } catch (error) {
      this.fail(action, error);
      return false;
    } finally {
      this.schedule(300);
    }
  }

  private fail(action: string, error: unknown): void {
    const kind = isFsapiError(error) ? error.kind : "unknown";
    const lastError: ActionError = {
      action,
      kind,
      message: error instanceof Error ? error.message : String(error),
      at: this.opts.now(),
    };
    if (kind === "pin") this.update({ connection: "pin-required", lastError });
    else if (kind === "network" || kind === "timeout")
      this.update({ connection: "offline", lastError });
    else this.update({ lastError });
  }

  private updatePlay(patch: Partial<PlayState>): void {
    const play = this.snapshot.play;
    const changed = (Object.keys(patch) as (keyof PlayState)[]).some((k) => play[k] !== patch[k]);
    if (changed) this.update({ play: { ...play, ...patch } });
  }

  private update(patch: Partial<RadioSnapshot>): void {
    const current = this.snapshot as unknown as Record<string, unknown>;
    const changed = Object.entries(patch).some(([k, v]) => current[k] !== v);
    if (!changed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
}
