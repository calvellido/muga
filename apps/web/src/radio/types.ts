import type {
  FsapiClient,
  FsapiErrorKind,
  ListItem,
  NavOptions,
  NodeValue,
} from "@muga/fsapi-core";

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
  /** The radio answered that `nav.preset.delete` doesn't exist. */
  deleteUnsupported?: boolean;
  /** Slot being written (store, delete, move). */
  busyKey?: number | undefined;
}

/** How a menu entry behaves. Forms, logins and unknown types aren't supported yet. */
export type BrowseItemKind = "folder" | "playable" | "message" | "error" | "unsupported";

export interface BrowseItem {
  key: number;
  name: string;
  kind: BrowseItemKind;
  artist: string;
  artworkUrl: string;
}

/** One step from the top menu: a folder that was opened, or a search that was run. */
export type BrowseCrumb =
  | { kind: "folder"; key: number; name: string }
  | { kind: "search"; key: number; term: string };

export interface BrowseState {
  /** unsupported: the source has no menu (`nav.caps`); unavailable: its menu didn't open. */
  status: "idle" | "loading" | "ready" | "unsupported" | "unavailable" | "error";
  /** Source the menu belongs to. */
  modeKey: number | undefined;
  path: BrowseCrumb[];
  items: BrowseItem[];
  /** Key of this level's SearchDirectory item; search is offered when set. */
  searchKey: number | undefined;
  /** `nav.numItems` without the search entry, when the radio knows it. */
  total: number | undefined;
  /** Start key of the next page; undefined at the end of the list. */
  nextKey: number | undefined;
  loadingMore: boolean;
  /** A step (open, back, search, play…) is running. */
  busy: boolean;
  /** Item being opened or played. */
  pendingKey: number | undefined;
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
  browse: BrowseState;
  lastError: ActionError | undefined;
}

/** What the presets and browse helpers need from their RadioController. */
export interface RadioContext {
  readonly client: FsapiClient;
  readonly nav: NavOptions;
  snapshot(): RadioSnapshot;
  update(patch: Partial<RadioSnapshot>): void;
  /** Runs an action; a failure becomes `lastError` and resolves false. */
  run(action: string, task: () => Promise<void>): Promise<boolean>;
  fail(action: string, error: unknown): void;
  /** Something else is playing now: re-read the track details soon. */
  playbackChanged(): void;
}
