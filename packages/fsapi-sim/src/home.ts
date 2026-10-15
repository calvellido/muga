import {
  createMultiroomNetwork,
  type MultiroomNetwork,
  type MultiroomNetworkOptions,
} from "./multiroom.ts";
import type { SimProfile } from "./profile.ts";
import { type RadioSimulator, type SimulatorOptions, startSimulator } from "./server.ts";

export interface SimulatedHomeOptions
  extends Omit<SimulatorOptions, "port" | "profile" | "multiroom"> {
  /** How many of the {@link HOME_SPEAKERS} to start, or a profile per speaker. Default 3. */
  speakers?: number | Partial<SimProfile>[];
  /** Port of the first speaker; the others count up from it. Default 0 (any free ports). */
  basePort?: number;
  network?: MultiroomNetworkOptions;
}

export interface SimulatedHome {
  readonly speakers: readonly RadioSimulator[];
  readonly network: MultiroomNetwork;
  close(): Promise<void>;
}

const speaker = (
  n: number,
  name: string,
  values: SimProfile["values"] = {},
): Partial<SimProfile> => {
  const id = String(n).padStart(2, "0");
  return {
    values: {
      "netRemote.sys.info.friendlyName": name,
      "netRemote.sys.info.radioId": `0022610000${id}`,
      "netRemote.sys.info.serialNumber": `SIM00000${id}`,
      "netRemote.sys.net.wlan.macAddress": `00:22:61:00:00:${id}`,
      ...values,
    },
  };
};

/** Speakers of a made-up home, each doing something different. */
export const HOME_SPEAKERS: readonly Partial<SimProfile>[] = [
  speaker(1, "Living room", { "netRemote.sys.audio.volume": 14 }),
  speaker(2, "Kitchen", {
    "netRemote.sys.info.modelName": "Muga Sim Mini",
    "netRemote.sys.mode": 3,
    "netRemote.play.info.name": "Coastline Jazz",
    "netRemote.play.info.text": "Smooth sounds for the afternoon",
    "netRemote.play.caps": 0x802,
    "netRemote.sys.audio.volume": 10,
  }),
  speaker(3, "Bedroom", {
    "netRemote.sys.power": "OFF",
    "netRemote.play.status": "IDLE",
    "netRemote.sys.audio.volume": 6,
  }),
  speaker(4, "Study", {
    "netRemote.sys.mode": 1,
    "netRemote.play.info.name": "Spotify",
    "netRemote.play.info.text": "Simulated track 1",
    "netRemote.sys.audio.volume": 12,
  }),
  speaker(5, "Garden room", {
    "netRemote.sys.info.modelName": "Muga Sim Mini",
    "netRemote.play.status": "STOPPED",
    "netRemote.sys.audio.volume": 9,
  }),
];

/** Simulated speakers on one multiroom network, so they can be grouped. */
export async function startSimulatedHome(
  options: SimulatedHomeOptions = {},
): Promise<SimulatedHome> {
  const { speakers = 3, basePort, network: networkOptions, ...simulator } = options;
  const profiles =
    typeof speakers === "number"
      ? Array.from(
          { length: speakers },
          (_, i) => HOME_SPEAKERS[i] ?? speaker(i + 1, `Speaker ${i + 1}`),
        )
      : speakers;
  const network = createMultiroomNetwork(networkOptions);
  const started: RadioSimulator[] = [];
  try {
    for (const [i, profile] of profiles.entries()) {
      started.push(
        await startSimulator({
          ...simulator,
          profile,
          multiroom: network,
          ...(basePort ? { port: basePort + i } : {}),
        }),
      );
    }
  } catch (error) {
    await Promise.all(started.map((s) => s.close()));
    throw error;
  }
  return {
    speakers: started,
    network,
    async close() {
      await Promise.all(started.map((s) => s.close()));
    },
  };
}
