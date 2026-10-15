import type { ScalarPath } from "@muga/fsapi-core";
import { LatestWins } from "./latest.ts";
import type { GroupMix, RadioContext } from "./types.ts";

const CLIENT_VOLUME = [
  "netRemote.multiroom.client.volume0",
  "netRemote.multiroom.client.volume1",
  "netRemote.multiroom.client.volume2",
  "netRemote.multiroom.client.volume3",
] as const satisfies readonly ScalarPath[];

const CLIENT_MUTE = [
  "netRemote.multiroom.client.mute0",
  "netRemote.multiroom.client.mute1",
  "netRemote.multiroom.client.mute2",
  "netRemote.multiroom.client.mute3",
] as const satisfies readonly ScalarPath[];

const MASTER = "netRemote.multiroom.group.masterVolume";

/** Read with every active poll while this radio is the server of the group on screen. */
export const MIXER_NODES = [MASTER, ...CLIENT_VOLUME, ...CLIENT_MUTE] as const;

type MixerValues = {
  [P in (typeof MIXER_NODES)[number]]?: P extends (typeof CLIENT_MUTE)[number]
    ? "NOT_MUTE" | "MUTE" | number
    : number;
};

/** Poll results are ignored this long after a slider was moved, so it doesn't jump back. */
const SETTLE_MS = 800;

export function emptyMix(): GroupMix {
  return {
    master: undefined,
    clients: CLIENT_VOLUME.map(() => ({ volume: undefined, muted: false })),
  };
}

/**
 * A group's volumes, all set on its server (Analysis doc 05 §5): the master volume and each
 * client's volume and mute, by client number. The server's own volume is the radio's ordinary
 * volume. All of them are in the server's volume steps, as UNDOK has them.
 */
export class GroupMixer {
  private readonly master: LatestWins<number>;
  private readonly clients: LatestWins<number>[];
  private readonly settleUntil = new Map<number | "master", number>();

  constructor(private readonly context: RadioContext) {
    const settle = (slot: number | "master") => () =>
      this.settleUntil.set(slot, this.context.now() + SETTLE_MS);
    this.master = new LatestWins((value) => this.context.client.set(MASTER, value), {
      onError: (error) => this.context.fail("groupVolume", error),
      onSettled: settle("master"),
    });
    this.clients = CLIENT_VOLUME.map(
      (path, n) =>
        new LatestWins((value: number) => this.context.client.set(path, value), {
          onError: (error) => this.context.fail("groupVolume", error),
          onSettled: settle(n),
        }),
    );
  }

  /** Takes in a poll's values; sliders being moved keep their own value. */
  observe(values: MixerValues): void {
    const current = this.context.snapshot().mixer ?? emptyMix();
    const now = this.context.now();
    const fresh = (slot: number | "master", writer: LatestWins<number> | undefined) =>
      !writer?.busy && now >= (this.settleUntil.get(slot) ?? 0);
    const mix: GroupMix = {
      master: fresh("master", this.master) ? (values[MASTER] ?? current.master) : current.master,
      clients: current.clients.map((client, n) => {
        const volume = values[CLIENT_VOLUME[n] ?? MASTER];
        const mute = values[CLIENT_MUTE[n] ?? MASTER];
        return {
          volume: fresh(n, this.clients[n]) ? (volume ?? client.volume) : client.volume,
          muted: mute === undefined ? client.muted : mute === "MUTE",
        };
      }),
    };
    if (JSON.stringify(mix) !== JSON.stringify(current)) this.context.update({ mixer: mix });
  }

  setMaster(value: number): Promise<boolean> {
    const master = this.clamp(value);
    this.patch((mix) => ({ ...mix, master }));
    this.settleUntil.set("master", this.context.now() + SETTLE_MS);
    return this.master.push(master);
  }

  setClientVolume(clientNumber: number, value: number): Promise<boolean> {
    const writer = this.clients[clientNumber];
    if (!writer) return Promise.resolve(false);
    const volume = this.clamp(value);
    this.patchClient(clientNumber, { volume });
    this.settleUntil.set(clientNumber, this.context.now() + SETTLE_MS);
    return writer.push(volume);
  }

  setClientMute(clientNumber: number, muted: boolean): Promise<boolean> {
    const path = CLIENT_MUTE[clientNumber];
    if (!path) return Promise.resolve(false);
    return this.context.run("groupMute", async () => {
      await this.context.client.set(path, muted ? "MUTE" : "NOT_MUTE");
      this.patchClient(clientNumber, { muted });
    });
  }

  /** Mutes or unmutes the server and its clients at once, like UNDOK's mute button in a group. */
  setGroupMute(muted: boolean, clientNumbers: readonly number[]): Promise<boolean> {
    const value = muted ? "MUTE" : "NOT_MUTE";
    return this.context.run("groupMute", async () => {
      const paths = clientNumbers.flatMap((n) => CLIENT_MUTE[n] ?? []);
      const errors = await this.context.client.setMultiple([
        ["netRemote.sys.audio.mute", value],
        ...paths.map((path) => [path, value] as const),
      ]);
      const error = Object.values(errors)[0];
      if (error) throw error;
      this.context.update({ muted });
      for (const n of clientNumbers) this.patchClient(n, { muted });
    });
  }

  private clamp(value: number): number {
    const max = Math.max(0, this.context.snapshot().volumeSteps - 1);
    return Math.round(Math.min(max, Math.max(0, value)));
  }

  private patch(change: (mix: GroupMix) => GroupMix): void {
    this.context.update({ mixer: change(this.context.snapshot().mixer ?? emptyMix()) });
  }

  private patchClient(clientNumber: number, change: Partial<GroupMix["clients"][number]>): void {
    this.patch((mix) => ({
      ...mix,
      clients: mix.clients.map((client, n) =>
        n === clientNumber ? { ...client, ...change } : client,
      ),
    }));
  }
}
