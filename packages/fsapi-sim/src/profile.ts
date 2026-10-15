import type { NavItemSubType, NavItemType } from "@muga/fsapi-core";

/** Initial radio state. Scalars use decoded values (enum names, text); lists use catalog field names. */
export interface SimProfile {
  values: Record<string, number | string>;
  lists: Record<string, SimListItem[]>;
  /** Per source, keyed by the `sys.caps.validModes` item `id`. */
  modes: Record<string, SimModeProfile>;
  /** Nodes this simulated model doesn't implement (answer FS_NODE_DOES_NOT_EXIST). */
  missingNodes: string[];
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
};
