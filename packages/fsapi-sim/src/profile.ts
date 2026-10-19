import { ipv4ToU32, type NavItemSubType, type NavItemType } from "@muga/fsapi-core";
import type { SimWifiNetwork } from "./network.ts";

/** Initial radio state. Scalars use decoded values (enum names, text); lists use catalog field names. */
export interface SimProfile {
  values: Record<string, number | string>;
  lists: Record<string, SimListItem[]>;
  /** Per source, keyed by the `sys.caps.validModes` item `id`. */
  modes: Record<string, SimModeProfile>;
  /** Nodes this simulated model doesn't implement (answer FS_NODE_DOES_NOT_EXIST). */
  missingNodes: string[];
  /** What a Wi-Fi scan finds. */
  wifi?: SimWifiNetwork[];
}

export interface SimListItem {
  key: number;
  [field: string]: number | string;
}

export interface SimModeProfile {
  /** Scalars applied when the radio switches to this source (e.g. `nav.caps`, `play.caps`). */
  values?: Record<string, number | string>;
  /** The source's top menu, served as `nav.list` once navigation is on. */
  menu?: SimMenuItem[];
  /** FM: stations to tune to and seek between. Other frequencies play as plain "<MHz>MHz". */
  stations?: SimFmStation[];
  /** DAB: what a scan finds (and keeps after pruning). Default: the menu. */
  scan?: SimMenuItem[];
}

export interface SimFmStation {
  /** kHz */
  frequency: number;
  /** RDS programme service name. */
  name: string;
  /** RDS radiotext. */
  text?: string;
}

export interface SimMenuItem {
  name: string;
  /** Default: Directory when it has `children`, PlayableItem otherwise. */
  type?: keyof typeof NavItemType;
  subType?: keyof typeof NavItemSubType;
  artist?: string;
  graphicUri?: string;
  children?: SimMenuItem[];
}

// `play.caps` bits (doc 05 §2.1).
const PAUSE = 0x1;
const STOP = 0x2;
const NEXT = 0x4;
const PREVIOUS = 0x8;
const SHUFFLE = 0x40;
const REPEAT = 0x80;
const ADD_PRESET = 0x800;
const REPEAT_ONE = 0x1_0000;
const ALL_CONTROLS = PAUSE | STOP | NEXT | PREVIOUS | SHUFFLE | REPEAT | ADD_PRESET;

// `nav.caps` bits (doc 05 §1.2): navigation, presets, preset editing.
const BROWSE_AND_PRESETS = 0x7;
const PRESETS_ONLY = 0x6;

const station = (name: string): SimMenuItem => ({ name, subType: "Station" });

const numbered = (prefix: string, count: number, subType: SimMenuItem["subType"] = "Station") =>
  Array.from({ length: count }, (_, i): SimMenuItem => ({ name: `${prefix} ${i + 1}`, subType }));

const INTERNET_RADIO_MENU: SimMenuItem[] = [
  { name: "Search", type: "SearchDirectory" },
  {
    name: "Local stations",
    children: [station("Radio Muga"), station("Frontera FM"), station("Harbour Talk")],
  },
  {
    name: "Genres",
    children: [
      // More than one page (14 items), to exercise paging.
      { name: "Jazz", children: numbered("Jazz Lounge", 30) },
      { name: "Classical", children: [station("Bay Classical"), station("Chamber Hours")] },
      { name: "News", children: [station("Delta News"), station("World Desk")] },
      { name: "Experimental", children: [] },
    ],
  },
  {
    name: "Podcasts",
    children: [
      {
        name: "Border Stories",
        children: numbered("Episode", 5, "Podcast").map((e) => ({
          ...e,
          artist: "Border Stories",
        })),
      },
    ],
  },
];

const DAB_STATIONS = [
  "Atlantic Hits",
  "Bay Classical",
  "Coastline Jazz",
  "Delta News",
  "Echo Rock",
  "Fjord Folk",
  "Granite Talk",
  "Harbour Pop",
  "Island Chill",
  "Junction Country",
  "Kite Kids",
  "Lighthouse Soul",
  "Meridian Sport",
  "Northern Lights",
  "Orchard Gold",
  "Pine Valley",
].map(station);

const emptyPreset = (key: number): SimListItem => ({
  key,
  name: "",
  type: "",
  uniqid: "",
  blob: "",
  artworkUrl: "",
  url: "",
});

export const DEFAULT_PROFILE: SimProfile = {
  values: {
    "netRemote.sys.info.friendlyName": "Muga Simulator",
    "netRemote.sys.info.version": "ir-mmi-FS2026-0500-0000_V2.14.35.SIM",
    "netRemote.sys.info.radioId": "002261000000",
    "netRemote.sys.info.serialNumber": "SIM0000001",
    "netRemote.sys.info.modelName": "Muga Sim",
    "netRemote.sys.power": "ON",
    "netRemote.sys.mode": 0,
    "netRemote.sys.audio.volume": 8,
    "netRemote.sys.caps.volumeSteps": 33,
    "netRemote.sys.audio.mute": "NOT_MUTE",
    "netRemote.play.status": "PLAYING",
    "netRemote.play.caps": ALL_CONTROLS,
    "netRemote.play.info.name": "Radio Muga",
    "netRemote.play.info.text": "Simulated broadcast",
    "netRemote.play.repeat": "OFF",
    "netRemote.play.shuffle": "OFF",
    "netRemote.sys.net.wlan.connectedSSID": "MugaNet",
    "netRemote.sys.net.wlan.rssi": 60,
    "netRemote.nav.state": "OFF",
    // Navigation is off until a controller enables it (nav.state=ON → READY_ROOT).
    "netRemote.nav.status": "FAIL",
    "netRemote.nav.caps": BROWSE_AND_PRESETS,
    "netRemote.nav.preset.currentPreset": 0,
    "netRemote.play.info.artist": "",
    "netRemote.play.info.album": "",
    "netRemote.play.info.graphicUri": "",
    "netRemote.play.info.duration": 0,
    "netRemote.play.position": 0,
    // FM band as an ICD2018 reports it (kHz).
    "netRemote.sys.caps.fmFreqRange.lower": 87_500,
    "netRemote.sys.caps.fmFreqRange.upper": 108_000,
    "netRemote.sys.caps.fmFreqRange.stepSize": 50,
    "netRemote.play.frequency": 93_200,
    // Settings (doc 06 §3).
    "netRemote.sys.net.wlan.macAddress": "00:22:61:00:00:00",
    "netRemote.sys.net.wired.interfaceEnable": "INTERFACE_DISABLE",
    "netRemote.sys.net.wired.macAddress": "00:22:61:00:00:01",
    "netRemote.sys.net.wlan.interfaceEnable": "INTERFACE_ENABLE",
    "netRemote.sys.net.wlan.region": "EUROPE",
    "netRemote.sys.net.wlan.regionFcc": "NOT_ACTIVE",
    "netRemote.sys.net.keepConnected": "YES",
    // Documentation addresses (RFC 5737), as the radio stores them: one u32 each.
    "netRemote.sys.net.ipConfig.dhcp": "YES",
    "netRemote.sys.net.ipConfig.address": ipv4ToU32("192.0.2.10") ?? 0,
    "netRemote.sys.net.ipConfig.subnetMask": ipv4ToU32("255.255.255.0") ?? 0,
    "netRemote.sys.net.ipConfig.gateway": ipv4ToU32("192.0.2.1") ?? 0,
    "netRemote.sys.net.ipConfig.dnsPrimary": ipv4ToU32("192.0.2.1") ?? 0,
    "netRemote.sys.net.ipConfig.dnsSecondary": 0,
    "netRemote.sys.sleep": 0,
    "netRemote.sys.audio.eqPreset": 1,
    "netRemote.sys.audio.eqLoudness": "OFF",
    "netRemote.sys.audio.eqCustom.param0": 0,
    "netRemote.sys.audio.eqCustom.param1": 0,
    "netRemote.sys.lang": 0,
    "netRemote.sys.audio.airableQuality": "NORMAL",
    "netRemote.sys.clock.mode": "_24_HOUR",
    "netRemote.sys.clock.source": "SNTP",
    "netRemote.sys.clock.utcOffset": 3600,
    "netRemote.sys.clock.dst": "ON",
    "netRemote.sys.clock.timeZone": "UTC+01:00: Madrid, Paris, Berlin",
    "netRemote.sys.clock.localDate": "20260115",
    "netRemote.sys.clock.localTime": "093000",
    // Speakers group only with speakers of the same multiroom protocol (doc 05 §6.2).
    "netRemote.multiroom.caps.protocolVersion": 3,
  },
  lists: {
    "netRemote.sys.caps.validModes": [
      { key: 0, id: "IR", selectable: 1, label: "Internet radio", streamable: 1, modeType: 0 },
      { key: 1, id: "Spotify", selectable: 1, label: "Spotify", streamable: 1, modeType: 0 },
      { key: 2, id: "DMR", selectable: 0, label: "Local music", streamable: 1, modeType: 0 },
      { key: 3, id: "DAB", selectable: 1, label: "DAB", streamable: 0, modeType: 0 },
      { key: 4, id: "FM", selectable: 1, label: "FM", streamable: 0, modeType: 0 },
      { key: 5, id: "BLUETOOTH", selectable: 1, label: "Bluetooth", streamable: 0, modeType: 0 },
      { key: 6, id: "AUXIN", selectable: 1, label: "Aux in", streamable: 0, modeType: 0 },
    ],
    "netRemote.sys.caps.eqPresets": [
      { key: 0, label: "My EQ" },
      { key: 1, label: "Normal" },
      { key: 2, label: "Flat" },
      { key: 3, label: "Jazz" },
      { key: 4, label: "Rock" },
      { key: 5, label: "Movie" },
      { key: 6, label: "Classic" },
      { key: 7, label: "Pop" },
      { key: 8, label: "News" },
    ],
    "netRemote.sys.caps.eqBands": [
      { key: 0, label: "Bass", min: -7, max: 7 },
      { key: 1, label: "Treble", min: -7, max: 7 },
    ],
    "netRemote.sys.caps.validLang": [
      { key: 0, langLabel: "English" },
      { key: 1, langLabel: "Deutsch" },
      { key: 2, langLabel: "Español" },
      { key: 3, langLabel: "Français" },
      { key: 4, langLabel: "Italiano" },
    ],
    "netRemote.sys.caps.clockSourceList": [
      { key: 0, source: "NETWORK" },
      { key: 1, source: "DAB" },
      { key: 2, source: "FM" },
      { key: 3, source: "NO_UPDATE" },
    ],
    "netRemote.sys.caps.utcSettingsList": [
      { key: 0, time: 0, region: "UTC+00:00: London, Lisbon" },
      { key: 1, time: 3600, region: "UTC+01:00: Madrid, Paris, Berlin" },
      { key: 2, time: 7200, region: "UTC+02:00: Athens, Helsinki" },
      { key: 3, time: -18000, region: "UTC-05:00: New York, Toronto" },
    ],
    // `url` isn't a declared field of the node, but UNDOK reads it and sends it back in LIST_SET.
    "netRemote.nav.presets": [
      {
        ...emptyPreset(0),
        name: "Radio Muga",
        type: "IR",
        uniqid: "sim-0",
        url: "http://radio.example/radio-muga",
      },
      {
        ...emptyPreset(1),
        name: "Frontera FM",
        type: "IR",
        uniqid: "sim-1",
        url: "http://radio.example/frontera-fm",
      },
      emptyPreset(2),
      emptyPreset(3),
    ],
  },
  modes: {
    IR: {
      values: { "netRemote.nav.caps": BROWSE_AND_PRESETS, "netRemote.play.caps": ALL_CONTROLS },
      menu: INTERNET_RADIO_MENU,
    },
    Spotify: {
      values: {
        "netRemote.nav.caps": 0,
        "netRemote.play.caps": PAUSE | NEXT | PREVIOUS | SHUFFLE | REPEAT | REPEAT_ONE,
      },
    },
    DAB: {
      scan: DAB_STATIONS.slice(0, 12),
      values: {
        "netRemote.nav.caps": BROWSE_AND_PRESETS,
        "netRemote.play.caps": STOP | ADD_PRESET,
      },
      menu: DAB_STATIONS,
    },
    FM: {
      stations: [
        { frequency: 88_600, name: "Muga FM", text: "Music from the border" },
        { frequency: 93_200, name: "Frontera", text: "News on the hour" },
        { frequency: 99_100, name: "Harbour", text: "Talk and weather" },
        { frequency: 104_800, name: "Atlantic", text: "Hits all day" },
      ],
      // Next / previous seek, as on an ICD2018.
      values: {
        "netRemote.nav.caps": PRESETS_ONLY,
        "netRemote.play.caps": NEXT | PREVIOUS | ADD_PRESET,
      },
    },
    BLUETOOTH: {
      values: { "netRemote.nav.caps": 0, "netRemote.play.caps": PAUSE | NEXT | PREVIOUS },
    },
    AUXIN: { values: { "netRemote.nav.caps": 0, "netRemote.play.caps": 0 } },
  },
  missingNodes: [],
  // The same name twice (two access points) and a hidden network, as real scans return them.
  wifi: [
    { ssid: "MugaNet", secured: true, signal: 60 },
    { ssid: "Frontera 5G", secured: true, signal: 48 },
    { ssid: "MugaNet", secured: true, signal: 31 },
    { ssid: "Café Muga", secured: false, signal: 35 },
    { ssid: "", secured: true, signal: 22 },
  ],
};
