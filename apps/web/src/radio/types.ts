import type { FsapiErrorKind, ListItem, NodeValue } from "@muga/fsapi-core";

export interface RadioConfig {
  /** Stable id: the radio's `sys.info.radioId`, or its host when that is unavailable. */
  id: string;
  /** IP, host:port or FSAPI base URL. */
  host: string;
  pin: string;
  /** Name at the time the radio was added; the live name comes from the snapshot. */
  name: string;
}

export type ConnectionState = "connecting" | "online" | "offline" | "pin-required";

export type SourceMode = ListItem<"netRemote.sys.caps.validModes">;
export type Preset = ListItem<"netRemote.nav.presets">;

export type PlayStatus = NodeValue<"netRemote.play.status">;
export type RepeatMode = "OFF" | "REPEAT_ALL" | "REPEAT_ONE";
export type PlayAction = "PLAY" | "PAUSE" | "STOP" | "NEXT" | "PREVIOUS";

export interface PresetsState {
  status: "idle" | "loading" | "ready" | "unsupported" | "standby" | "error";
  items: Preset[];
}

export interface PlayState {
  status: PlayStatus | undefined;
  name: string;
  text: string;
  artist: string;
  album: string;
  artworkUrl: string;
  durationMs: number;
  /** Last position read from the radio, and when it was read (for interpolation). */
  positionMs: number;
  positionAt: number;
  /** `play.caps` bitmask (see caps.ts). */
  caps: number;
  shuffle: boolean;
  repeat: RepeatMode;
}

export interface ActionError {
  action: string;
  kind: FsapiErrorKind | "unknown";
  message: string;
  at: number;
}

export interface RadioSnapshot {
  config: RadioConfig;
  connection: ConnectionState;
  name: string;
  version: string;
  model: string;
  volumeSteps: number;
  power: boolean | undefined;
  modeKey: number | undefined;
  /** Selectable sources only. */
  modes: SourceMode[];
  volume: number | undefined;
  muted: boolean;
  play: PlayState;
  /** `nav.caps` bitmask, or undefined when the radio doesn't report it. */
  navCaps: number | undefined;
  currentPreset: number | undefined;
  presets: PresetsState;
  lastError: ActionError | undefined;
}
