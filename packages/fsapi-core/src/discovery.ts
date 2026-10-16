import { DEFAULT_PIN, FsapiClient } from "./client.ts";
import { isFsapiError } from "./errors.ts";
import type { FetchLike } from "./types.ts";

/**
 * Finding radios over HTTP only (ADR 0011). Browsers can't use SSDP or mDNS (UDP), so radios are
 * found by asking addresses. `GET /device` needs no PIN and real radios answer it with
 * `Access-Control-Allow-Origin: *`; FSAPI then tells the radio id, or that the PIN was refused.
 */

/** Ranges home routers commonly use, the most common first. */
export const COMMON_SUBNETS = [
  "192.168.1",
  "192.168.0",
  "192.168.178",
  "192.168.2",
  "192.168.68",
  "192.168.86",
  "192.168.50",
  "10.0.0",
  "10.0.1",
] as const;

const PRIVATE_IPV4 = /^(10\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+|192\.168\.\d+)\.\d+$/;

/** The /24 of a private IPv4 address (`192.168.1` for `192.168.1.57:80`), else undefined. */
export function subnetOf(host: string): string | undefined {
  const bare = host
    .trim()
    .replace(/^[a-z]+:\/\//i, "")
    .replace(/[:/].*$/, "");
  return PRIVATE_IPV4.test(bare) ? bare.replace(/\.\d+$/, "") : undefined;
}

/** The addresses of a /24: `<subnet>.1` to `<subnet>.254`. */
export function subnetHosts(subnet: string): string[] {
  return Array.from({ length: 254 }, (_, i) => `${subnet}.${i + 1}`);
}

export interface FoundRadio {
  /** Where it answered: the address scanned. */
  host: string;
  name: string;
  version: string;
  /** `sys.info.radioId`, when the PIN was accepted. */
  radioId: string | undefined;
  /** The radio refused the PIN. */
  pinRequired: boolean;
}

export interface ProbeOptions {
  fetch?: FetchLike;
  /** Default 1234. */
  pin?: string;
  /** Per request. Default 1500 ms: an address with nothing behind it takes ~3 s to fail. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Asks one address whether a radio answers there. */
export async function probeRadio(
  host: string,
  options: ProbeOptions = {},
): Promise<FoundRadio | undefined> {
  const client = new FsapiClient({
    host,
    pin: options.pin ?? DEFAULT_PIN,
    timeoutMs: options.timeoutMs ?? 1_500,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  const request = options.signal ? { signal: options.signal } : {};
  let name = "";
  let version = "";
  try {
    const doc = await client.getDeviceDocument(request);
    name = doc.friendlyName ?? "";
    version = doc.version ?? "";
  } catch (error) {
    // Nothing there (or a browser couldn't read the reply): not a radio. A server that answered
    // without a device document may still speak FSAPI.
    if (!isFsapiError(error) || !["http", "not-found", "parse"].includes(error.kind)) {
      return undefined;
    }
  }
  try {
    const radioId = (await client.get("netRemote.sys.info.radioId", request)).trim();
    if (!name) name = (await client.get("netRemote.sys.info.friendlyName", request)).trim();
    return { host, name: name || host, version, radioId: radioId || undefined, pinRequired: false };
  } catch (error) {
    if (isFsapiError(error, "pin")) {
      return { host, name: name || host, version, radioId: undefined, pinRequired: true };
    }
    // Answered /device but not FSAPI as expected: still a radio, as far as we can tell.
    return name ? { host, name, version, radioId: undefined, pinRequired: false } : undefined;
  }
}

export interface ScanOptions extends ProbeOptions {
  /** Addresses asked at once. Default 24. */
  concurrency?: number;
  onProgress?(done: number, total: number): void;
  onFound?(radio: FoundRadio): void;
  /** Stops the scan once it returns true, for example when looking for one radio. */
  until?(radio: FoundRadio): boolean;
}

/** Probes addresses, a few at a time, and resolves with the radios that answered. */
export async function scanForRadios(
  hosts: readonly string[],
  options: ScanOptions = {},
): Promise<FoundRadio[]> {
  const stop = new AbortController();
  const outer = options.signal;
  const abort = () => stop.abort();
  if (outer?.aborted) abort();
  outer?.addEventListener("abort", abort, { once: true });
  const found: FoundRadio[] = [];
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < hosts.length && !stop.signal.aborted) {
      const host = hosts[next++] as string;
      const radio = await probeRadio(host, { ...options, signal: stop.signal });
      done++;
      if (stop.signal.aborted) return;
      options.onProgress?.(done, hosts.length);
      if (!radio) continue;
      found.push(radio);
      options.onFound?.(radio);
      if (options.until?.(radio)) abort();
    }
  };
  try {
    await Promise.all(
      Array.from({ length: Math.min(options.concurrency ?? 24, hosts.length) }, worker),
    );
  } finally {
    outer?.removeEventListener("abort", abort);
  }
  return found;
}
