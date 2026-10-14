/** Initial radio state. Scalars use decoded values (enum names, text); lists use catalog field names. */
export interface SimProfile {
  values: Record<string, number | string>;
  lists: Record<string, SimListItem[]>;
  /** Nodes this simulated model doesn't implement (answer FS_NODE_DOES_NOT_EXIST). */
  missingNodes: string[];
}

export interface SimListItem {
  key: number;
  [field: string]: number | string;
}

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
    "netRemote.play.caps": 0,
    "netRemote.play.info.name": "Radio Muga",
    "netRemote.play.info.text": "Simulated broadcast",
    "netRemote.play.repeat": "OFF",
    "netRemote.play.shuffle": "OFF",
    "netRemote.sys.net.wlan.connectedSSID": "MugaNet",
    "netRemote.sys.net.wlan.rssi": 60,
    "netRemote.nav.state": "OFF",
    "netRemote.nav.status": "READY",
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
    "netRemote.nav.presets": [
      { key: 0, name: "Radio Muga", type: "IR", uniqid: "sim-0", blob: "", artworkUrl: "" },
      { key: 1, name: "Frontera FM", type: "FM", uniqid: "sim-1", blob: "", artworkUrl: "" },
      { key: 2, name: "", type: "", uniqid: "", blob: "", artworkUrl: "" },
    ],
  },
  missingNodes: [],
};
