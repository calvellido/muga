import { isFsapiError, type ScalarPath } from "@muga/fsapi-core";
import type { BrowseSession } from "./browse.ts";
import type { RadioContext, StatusReport, TroubleshootState } from "./types.ts";

export interface TroubleshootOptions {
  /** How long the radio stays in standby before it's turned on again. */
  standbyMs?: number;
}

/** What the radio reports about its playback, read before it's unstuck so it can be shared. */
const REPORT_NODES = [
  "netRemote.sys.power",
  "netRemote.sys.mode",
  "netRemote.sys.state",
  "netRemote.sys.audio.volume",
  "netRemote.sys.audio.mute",
  "netRemote.play.status",
  "netRemote.play.errorStr",
  "netRemote.play.info.name",
  "netRemote.play.info.text",
  "netRemote.spotify.status",
  "netRemote.spotify.loggedInState",
  "netRemote.spotify.lastError",
  "netRemote.multiroom.group.state",
  "netRemote.multiroom.group.name",
] as const satisfies readonly ScalarPath[];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The report as plain text, to paste into an issue or a message. */
export function reportText(report: StatusReport, header: readonly [string, string][]): string {
  return [...header, ["Read at", new Date(report.at).toISOString()], ...report.entries]
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
}

/**
 * "Unstick speaker", for a radio that says it plays but stays silent. Reads a status report,
 * then takes the radio's single FSAPI session and gives it up, so a session another app left
 * behind is gone, and puts the radio in standby and back on, which restarts its audio and its
 * Spotify Connect player. A true reboot isn't offered: the only node that reboots the radio,
 * `sys.net.commitChanges`, also applies network settings.
 */
export class Troubleshooter {
  private readonly standbyMs: number;

  constructor(
    private readonly ctx: RadioContext,
    private readonly browse: BrowseSession,
    options: TroubleshootOptions = {},
  ) {
    this.standbyMs = options.standbyMs ?? 3_000;
  }

  private get state(): TroubleshootState {
    return this.ctx.snapshot().troubleshoot;
  }

  private set(patch: Partial<TroubleshootState>): void {
    this.ctx.update({ troubleshoot: { ...this.state, ...patch } });
  }

  private get busy(): boolean {
    return !["idle", "done", "failed", "confirmGroup"].includes(this.state.step);
  }

  /**
   * Reads the report, then unsticks the radio. A radio in a multiroom group waits for `confirm`,
   * since the other speakers of the group may go quiet too.
   */
  async start(): Promise<void> {
    if (this.busy) return;
    this.set({ step: "checking", groupName: undefined });
    const report = await this.readReport();
    const role = report.entries.find(([path]) => path === "netRemote.multiroom.group.state")?.[1];
    if (role === "CLIENT" || role === "SERVER") {
      const name = report.entries.find(([path]) => path === "netRemote.multiroom.group.name")?.[1];
      this.set({ step: "confirmGroup", report, groupName: name ?? "" });
      return;
    }
    this.set({ report });
    await this.unstick();
  }

  confirm(): Promise<void> {
    return this.state.step === "confirmGroup" ? this.unstick() : Promise.resolve();
  }

  cancel(): void {
    if (this.state.step === "confirmGroup") this.set({ step: "idle", groupName: undefined });
  }

  private async readReport(): Promise<StatusReport> {
    const at = this.ctx.now();
    try {
      const { values, errors } = await this.ctx.client.getMultiple(REPORT_NODES);
      const entries = REPORT_NODES.map((path): [string, string] => {
        const value = values[path];
        if (value !== undefined) return [path, String(value)];
        const error = errors[path];
        return [path, error ? `(${error.fsStatus ?? error.kind})` : "(no answer)"];
      });
      return { at, entries };
    } catch (error) {
      const message = isFsapiError(error) ? error.kind : String(error);
      return { at, entries: [["Error", message]] };
    }
  }

  private async unstick(): Promise<void> {
    const { client } = this.ctx;
    const modeKey = this.ctx.snapshot().modeKey;
    try {
      this.set({ step: "reconnecting" });
      // The radio keeps one session: taking it ends the one another app holds.
      await client.deleteSession(await client.createSession());

      this.set({ step: "restarting" });
      await client.set("netRemote.sys.power", "OFF");
      this.browse.invalidate();
      this.ctx.update({ power: false });
      await sleep(this.standbyMs);
      await client.set("netRemote.sys.power", "ON");
      this.ctx.update({ power: true });
      if (modeKey !== undefined && (await client.get("netRemote.sys.mode")) !== modeKey) {
        await client.set("netRemote.sys.mode", modeKey);
      }
      this.set({ step: "done" });
    } catch (error) {
      this.set({ step: "failed" });
      this.ctx.fail("unstick", error);
    } finally {
      this.ctx.refreshInfo();
      this.ctx.playbackChanged();
    }
  }
}
