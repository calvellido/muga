import { FsapiError, settleNav } from "@muga/fsapi-core";
import type { BrowseSession } from "./browse.ts";
import type { DabScanState, RadioContext } from "./types.ts";

export interface DabScanOptions {
  /** Progress reads while scanning. UNDOK reads once a second. */
  pollMs?: number;
  /** Give up watching after this long. UNDOK stops at 60 s; scans can take longer. */
  timeoutMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * DAB station scan, as UNDOK runs it (doc 05 §3.11): reset the menu, start `nav.action.dabScan`,
 * follow `nav.dabScanUpdate` (stations found) until the scan is IDLE again, then prune stations
 * that can't be received (`nav.action.dabPrune`). A cancelled or interrupted scan isn't pruned.
 */
export class DabScanner {
  private running: Promise<boolean> | undefined;
  private cancelled = false;
  private readonly pollMs: number;
  private readonly timeoutMs: number;

  constructor(
    private readonly ctx: RadioContext,
    private readonly browse: BrowseSession,
    options: DabScanOptions = {},
  ) {
    this.pollMs = options.pollMs ?? 1_000;
    this.timeoutMs = options.timeoutMs ?? 5 * 60_000;
  }

  private set(patch: Partial<DabScanState>): void {
    this.ctx.update({ dabScan: { ...this.ctx.snapshot().dabScan, ...patch } });
  }

  get scanning(): boolean {
    return this.running !== undefined;
  }

  /** Follows a scan started elsewhere (the radio's own menu, another app). */
  async check(): Promise<void> {
    if (this.running) return;
    const scan = await this.ctx.client.get("netRemote.nav.action.dabScan").catch(() => undefined);
    if (scan === "SCAN" && !this.running) this.running = this.follow(() => this.watch());
  }

  scan(): Promise<boolean> {
    if (this.running) return this.running;
    this.running = this.follow(async () => {
      const { client, nav } = this.ctx;
      if ((await client.get("netRemote.nav.action.dabScan")) !== "SCAN") {
        // UNDOK resets the menu first; with no stations yet it settles on FATAL_ERR, which is fine.
        await client.set("netRemote.nav.state", "OFF");
        await client.set("netRemote.nav.state", "ON");
        await settleNav(client, nav);
        await client.set("netRemote.nav.action.dabScan", "SCAN");
      }
      return this.watch();
    });
    return this.running;
  }

  cancel(): Promise<boolean> {
    if (!this.running) return Promise.resolve(false);
    this.cancelled = true;
    return this.ctx.run("dabScan", () =>
      this.ctx.client.set("netRemote.nav.action.dabScan", "IDLE"),
    );
  }

  /** Clears a finished scan's message. */
  dismiss(): void {
    if (!this.running) this.set({ status: "idle" });
  }

  private follow(task: () => Promise<boolean>): Promise<boolean> {
    this.cancelled = false;
    this.set({ status: "scanning", found: 0 });
    this.browse.invalidate();
    return task()
      .catch((error: unknown) => {
        this.set({ status: "error" });
        this.ctx.fail("dabScan", error);
        return false;
      })
      .finally(() => {
        this.running = undefined;
        // The station list changed: open the menu again from the top.
        this.browse.invalidate();
      });
  }

  /** Reads progress until the scan stops; prunes only after a scan that ran to the end. */
  private async watch(): Promise<boolean> {
    const { client } = this.ctx;
    const modeKey = this.ctx.snapshot().modeKey;
    const deadline = this.ctx.now() + this.timeoutMs;
    for (;;) {
      const { values } = await client.getMultiple([
        "netRemote.nav.action.dabScan",
        "netRemote.nav.dabScanUpdate",
      ]);
      const found = values["netRemote.nav.dabScanUpdate"] ?? this.ctx.snapshot().dabScan.found;
      if (values["netRemote.nav.action.dabScan"] !== "SCAN") {
        this.set({ found });
        break;
      }
      this.set({ status: "scanning", found });
      if (this.ctx.now() > deadline) {
        throw new FsapiError("timeout", "The DAB scan didn't finish", {
          node: "netRemote.nav.action.dabScan",
        });
      }
      await sleep(this.pollMs);
    }

    // A source change or standby also stops a scan; pruning then would drop good stations.
    const snapshot = this.ctx.snapshot();
    if (this.cancelled || snapshot.modeKey !== modeKey || snapshot.power === false) {
      this.set({ status: "cancelled" });
      return false;
    }
    this.set({ status: "pruning" });
    await client.set("netRemote.nav.action.dabPrune", "PRUNE");
    for (let i = 0; i < 10; i++) {
      const prune = await client.get("netRemote.nav.action.dabPrune").catch(() => "IDLE");
      if (prune !== "PRUNE") break;
      await sleep(this.pollMs);
    }
    this.set({ status: "done" });
    return true;
  }
}
