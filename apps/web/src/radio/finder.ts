import {
  COMMON_SUBNETS,
  type FetchLike,
  type FoundRadio,
  scanForRadios,
  subnetHosts,
  subnetOf,
} from "@muga/fsapi-core";
import type { RadioConfig } from "./types.ts";

export interface FinderSnapshot {
  status: "idle" | "scanning" | "done" | "cancelled";
  /** The ranges looked at, as `192.168.1`. */
  subnets: string[];
  done: number;
  total: number;
  found: FoundRadio[];
}

export interface FinderRange {
  subnet: string;
  hosts: string[];
}

export interface FinderOptions {
  fetch?: FetchLike;
  /** Per address. Default 1500 ms. */
  timeoutMs?: number;
  /** Addresses asked at once. Default 24. */
  concurrency?: number;
  /** Whether anything at all answers at an address, to skip ranges with no router in them. */
  answers?: (host: string) => Promise<boolean>;
  /** Where to look instead of the usual ranges (tests). */
  ranges?: () => Promise<FinderRange[]>;
}

/** Any HTTP reply counts, readable or not: `no-cors` resolves for every server that answered. */
async function anyAnswer(host: string): Promise<boolean> {
  try {
    await fetch(`http://${host}/`, {
      mode: "no-cors",
      cache: "no-store",
      signal: AbortSignal.timeout(1_500),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Finds radios on the network by asking its addresses (ADR 0011), only when asked to: it sends a
 * request to every address of a range. The ranges are those of the saved speakers, or, with none
 * yet, the usual home ranges in which a router answers at `.1` or `.254`.
 */
export class SpeakerFinder {
  private snapshot: FinderSnapshot = { status: "idle", subnets: [], done: 0, total: 0, found: [] };
  private readonly listeners = new Set<() => void>();
  private stop: AbortController | undefined;

  constructor(
    private readonly host: { radios(): readonly RadioConfig[] },
    private readonly options: FinderOptions = {},
  ) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): FinderSnapshot => this.snapshot;

  /** Looks for radios on the network; resolves when the scan is over. */
  async scan(): Promise<void> {
    if (this.snapshot.status === "scanning") return;
    const stop = new AbortController();
    this.stop = stop;
    this.update({ status: "scanning", subnets: [], done: 0, total: 0, found: [] });
    const ranges = await this.ranges();
    if (stop.signal.aborted) return;
    const hosts = ranges.flatMap((r) => r.hosts);
    this.update({ subnets: ranges.map((r) => r.subnet), total: hosts.length });
    await scanForRadios(hosts, {
      ...this.scanOptions(),
      signal: stop.signal,
      onProgress: (done) => this.update({ done }),
      onFound: (radio) => this.update({ found: [...this.snapshot.found, radio] }),
    });
    if (!stop.signal.aborted) this.update({ status: "done", done: hosts.length });
  }

  cancel(): void {
    this.stop?.abort();
    if (this.snapshot.status === "scanning") this.update({ status: "cancelled" });
  }

  /** Looks for one radio by its radio id, without showing a scan. Resolves with where it is. */
  async locate(radioId: string, pin: string): Promise<FoundRadio | undefined> {
    const hosts = (await this.ranges()).flatMap((r) => r.hosts);
    const same = (radio: FoundRadio) => radio.radioId?.toUpperCase() === radioId.toUpperCase();
    const found = await scanForRadios(hosts, { ...this.scanOptions(), pin, until: same });
    return found.find(same);
  }

  private scanOptions() {
    return {
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
      timeoutMs: this.options.timeoutMs ?? 1_500,
      concurrency: this.options.concurrency ?? 24,
    };
  }

  private async ranges(): Promise<FinderRange[]> {
    if (this.options.ranges) return this.options.ranges();
    const saved = [...new Set(this.host.radios().flatMap((r) => subnetOf(r.host) ?? []))];
    if (saved.length > 0) return saved.map((subnet) => ({ subnet, hosts: subnetHosts(subnet) }));
    const answers = this.options.answers ?? anyAnswer;
    const live = await Promise.all(
      COMMON_SUBNETS.map(
        async (subnet) => (await answers(`${subnet}.1`)) || (await answers(`${subnet}.254`)),
      ),
    );
    return COMMON_SUBNETS.filter((_, i) => live[i]).map((subnet) => ({
      subnet,
      hosts: subnetHosts(subnet),
    }));
  }

  private update(patch: Partial<FinderSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
}
