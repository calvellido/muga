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
  /** Name at the time the radio was connected; the live name comes from the snapshot. */
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

/** FM band and tuning, in kHz (`sys.caps.fmFreqRange.*`, `play.frequency`). */
export interface TunerState {
  lower: number;
  upper: number;
  step: number;
  frequency: number | undefined;
}

export interface DabScanState {
  /** pruning: removing stations that can't be received, which UNDOK does after every scan. */
  status: "idle" | "scanning" | "pruning" | "done" | "cancelled" | "error";
  /** Stations found so far (`nav.dabScanUpdate`). */
  found: number;
}

export interface DeviceInfo {
  model: string;
  version: string;
  radioId: string;
  serial: string;
}

/** How the speaker is connected (`sys.net.*`). Addresses are dotted, empty when unknown. */
export interface NetworkInfo {
  /** Which interface is in use, when the radio says. */
  connection: "wifi" | "ethernet" | undefined;
  /** Wi-Fi network name (`sys.net.wlan.connectedSSID`, a byte array). */
  ssid: string;
  /** `sys.net.wlan.rssi` as the radio reports it; UNDOK draws it as a bar. */
  signal: number | undefined;
  /** The address comes from the router (DHCP); undefined when the radio doesn't say. */
  dhcp: boolean | undefined;
  address: string;
  subnetMask: string;
  gateway: string;
  /** DNS servers that are set (`0.0.0.0` is left out). */
  dns: string[];
  wifiMac: string;
  ethernetMac: string;
  /** `sys.net.wlan.region`, which decides the Wi-Fi channels it may use. */
  region: string | undefined;
  /** Stays on the network in standby (`sys.net.keepConnected`); undefined: no such setting. */
  keepConnected: boolean | undefined;
  /** It can be moved to another network or address: its `ipConfig` nodes answer. */
  editable: boolean;
}

/** A network a Wi-Fi scan found; the strongest access point of each name. */
export interface WifiNetwork {
  /** For `sys.net.wlan.selectAP`. */
  key: number;
  ssid: string;
  /** Needs a passphrase. */
  secured: boolean;
  signal: number;
}

export interface WifiScan {
  status: "scanning" | "ready" | "failed";
  networks: WifiNetwork[];
}

/** Wi-Fi security for a network typed by hand, as the radio's own web page offers it. */
export type WifiSecurity = "NONE" | "WEP" | "WPA" | "WPA2";

export type WifiChoice =
  | { kind: "scanned"; key: number; ssid: string; secured: boolean }
  | { kind: "manual"; ssid: string; security: WifiSecurity };

export type Addressing =
  | { dhcp: true }
  | { dhcp: false; address: string; subnetMask: string; gateway: string; dns: [string, string] };

/** New network settings, applied together with `sys.net.commitChanges`. */
export interface NetworkChange {
  connection: "wifi" | "ethernet";
  /** The Wi-Fi network to join; undefined stays on the current one. */
  wifi?: { network: WifiChoice; passphrase: string };
  addressing: Addressing;
}

export interface EqBand {
  key: number;
  label: string;
  min: number;
  max: number;
  value: number | undefined;
}

export interface EqState {
  presets: { key: number; label: string }[];
  /** Preset key 0 is the custom one, with adjustable bands (doc 06 §3.2). */
  current: number | undefined;
  bands: EqBand[];
  /** Undefined when the radio has no loudness setting. */
  loudness: boolean | undefined;
}

export type ClockSource = "MANUAL" | "DAB" | "FM" | "SNTP";

export interface ClockState {
  format: "12" | "24" | undefined;
  source: ClockSource | undefined;
  /** Sources the radio offers (`sys.caps.clockSourceList`). */
  sources: ClockSource[];
  /** Seconds east of UTC. */
  utcOffset: number | undefined;
  dst: boolean | undefined;
  /** Region label; undefined when the radio has no `sys.clock.timeZone` (ICD2018, V2.13). */
  timeZone: string | undefined;
  /** Time zones for network time (`sys.caps.utcSettingsList`), offsets in seconds. */
  zones: { key: number; offset: number; region: string }[];
  /** The radio's clock as `YYYYMMDD` and `HHMMSS`, and when it was read. */
  date: string;
  time: string;
  readAt: number;
}

/** What the radio found at its own last check for software updates (`sys.isu.*`). */
export type UpdateCheck =
  | { status: "checking" }
  | { status: "available"; version: string; important: boolean; summary: string }
  | { status: "updating"; progress: number }
  | { status: "none" | "notChecked" | "inProgress" | "failed" | "unsupported" | "error" };

export interface SettingsState {
  status: "idle" | "loading" | "ready" | "error";
  device: DeviceInfo | undefined;
  network: NetworkInfo | undefined;
  /** The last Wi-Fi scan; undefined until one is started. */
  wifiScan: WifiScan | undefined;
  /** The speaker's PIN can be changed (`sys.info.radioPin` answers). */
  pinChangeable: boolean;
  /** Seconds left on the sleep timer (0: off) and when they were read; undefined: no timer. */
  sleep: { remaining: number; readAt: number } | undefined;
  eq: EqState | undefined;
  clock: ClockState | undefined;
  /** The radio's own menu language. */
  language: { current: number | undefined; options: { key: number; label: string }[] } | undefined;
  /** Streaming quality, on whichever node the radio has. */
  quality:
    | {
        node: "netRemote.sys.audio.airableQuality" | "netRemote.sys.audio.quality";
        value: "LOW" | "NORMAL" | "HIGH";
      }
    | undefined;
  /** The last "Check for updates" result; undefined until it's pressed. */
  update: UpdateCheck | undefined;
}

/** A multiroom group's volumes, read from its server, in the server's volume steps. */
export interface GroupMix {
  /** `multiroom.group.masterVolume`. */
  master: number | undefined;
  /** By client number (`multiroom.client.volumeN`, `muteN`). */
  clients: { volume: number | undefined; muted: boolean }[];
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
  /** UPnP UDN (`sys.info.dmruuid`): with the radio id, how it's found in multiroom lists. */
  udn: string;
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
  /** Known once the radio has been on FM. */
  tuner: TunerState | undefined;
  dabScan: DabScanState;
  settings: SettingsState;
  /** Read while this radio serves the multiroom group on screen. */
  mixer: GroupMix | undefined;
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
  /** Re-read identity, sources and capabilities on the next poll (e.g. after a language change). */
  refreshInfo(): void;
  now(): number;
}
