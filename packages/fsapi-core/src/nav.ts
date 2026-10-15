import type { ListItem } from "./catalog.ts";
import type { FsapiClient, ListPage, RequestOptions } from "./client.ts";
import { FsapiError, isFsapiError } from "./errors.ts";

/**
 * Menu browsing (`netRemote.nav.*`), as UNDOK does it (Analysis doc 05 §3). The radio keeps one
 * menu position per device: these helpers move it and wait on `nav.status` after every step.
 */

/** `nav.action.navigate` key that goes up one level. */
export const NAV_UP = 0xffff_ffff;

/** UNDOK reads `nav.list` 14 items at a time; items are large (three 766-byte strings each). */
export const NAV_PAGE_SIZE = 14;

/** `nav.list` item `type` values. */
export const NavItemType = {
  Directory: 0,
  PlayableItem: 1,
  SearchDirectory: 2,
  Unknown: 3,
  FormItem: 4,
  MessageItem: 5,
  OAuth: 6,
  FetchErrItem: 255,
} as const;

/** `nav.list` item `subType` values. */
export const NavItemSubType = {
  None: 0,
  Station: 1,
  Podcast: 2,
  Track: 3,
  Text: 4,
  Password: 5,
  Options: 6,
  Submit: 7,
  Button: 8,
  Disabled: 9,
} as const;

export type NavListItem = ListItem<"netRemote.nav.list">;

export interface NavOptions extends RequestOptions {
  /** Delay between `nav.status` reads. UNDOK uses 500 ms. */
  pollMs?: number;
  /** Give up waiting after this long. UNDOK uses 30 s. */
  timeoutMs?: number;
}

export interface NavInfo {
  /** `nav.numItems`; undefined when the radio doesn't know (-1) or doesn't say. */
  numItems: number | undefined;
  depth: number | undefined;
}

type ReadyStatus = "READY" | "READY_ROOT";

const STATUS_NODE = "netRemote.nav.status";
/** Right after `nav.state=ON`, some firmware may still report the previous FAIL for a moment. */
const ENABLE_GRACE_MS = 2_000;

function isReady(status: unknown): status is ReadyStatus {
  return status === "READY" || status === "READY_ROOT";
}

function isFailed(status: unknown): boolean {
  return status === "FAIL" || status === "FATAL_ERR";
}

/** True for errors raised because `nav.status` reported FAIL / FATAL_ERR or never became ready. */
export function isNavFailure(error: unknown): error is FsapiError {
  return isFsapiError(error) && error.node === STATUS_NODE;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const aborted = () => new FsapiError("aborted", "Request aborted");
    if (signal?.aborted) return reject(aborted());
    const onAbort = () => {
      clearTimeout(timer);
      reject(aborted());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function request(options: NavOptions): RequestOptions {
  return options.signal ? { signal: options.signal } : {};
}

/**
 * Polls `nav.status` until READY or READY_ROOT. FAIL / FATAL_ERR end the wait, unless they are
 * seen within `graceMs` of the start.
 */
export async function waitForNav(
  client: FsapiClient,
  options: NavOptions & { graceMs?: number } = {},
): Promise<ReadyStatus> {
  const pollMs = options.pollMs ?? 500;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const graceMs = options.graceMs ?? 0;
  const start = Date.now();
  for (;;) {
    const status = await client.get(STATUS_NODE, request(options));
    if (isReady(status)) return status;
    const elapsed = Date.now() - start;
    if (isFailed(status) && elapsed >= graceMs) {
      throw new FsapiError("status", `Navigation failed (${status})`, { node: STATUS_NODE });
    }
    if (elapsed >= timeoutMs) {
      throw new FsapiError("timeout", "Navigation did not become ready", { node: STATUS_NODE });
    }
    await sleep(pollMs, options.signal);
  }
}

/** Ready as it is, or turns navigation on (`nav.state=ON`) and waits. Keeps the menu position. */
export async function ensureNavReady(client: FsapiClient, options: NavOptions = {}): Promise<void> {
  const status = await client.get(STATUS_NODE, request(options));
  if (isReady(status)) return;
  if (status !== "WAITING") await client.set("netRemote.nav.state", "ON", request(options));
  await waitForNav(client, { ...options, graceMs: ENABLE_GRACE_MS });
}

/** `nav.state` OFF then ON: back to the current source's top menu. */
export async function resetNav(client: FsapiClient, options: NavOptions = {}): Promise<void> {
  await client.set("netRemote.nav.state", "OFF", request(options));
  await client.set("netRemote.nav.state", "ON", request(options));
  await waitForNav(client, { ...options, graceMs: ENABLE_GRACE_MS });
}

/** Opens a Directory item, or goes up with {@link NAV_UP}. */
export async function navigate(
  client: FsapiClient,
  key: number,
  options: NavOptions = {},
): Promise<void> {
  await client.set("netRemote.nav.action.navigate", key, request(options));
  await waitForNav(client, options);
}

/** Plays a PlayableItem. FS_TRY_AGAIN is retried once after waiting, as UNDOK does. */
export async function selectNavItem(
  client: FsapiClient,
  key: number,
  options: NavOptions = {},
): Promise<void> {
  await waitForNav(client, options);
  try {
    await client.set("netRemote.nav.action.selectItem", key, request(options));
  } catch (error) {
    if (!isFsapiError(error, "status") || error.fsStatus !== "FS_TRY_AGAIN") throw error;
    await waitForNav(client, options);
    await client.set("netRemote.nav.action.selectItem", key, request(options));
  }
}

/** Runs a search through a SearchDirectory item (one SET_MULTIPLE, as UNDOK sends it). */
export async function searchNav(
  client: FsapiClient,
  searchKey: number,
  term: string,
  options: NavOptions = {},
): Promise<void> {
  const errors = await client.setMultiple(
    [
      ["netRemote.nav.searchTerm", term],
      ["netRemote.nav.action.navigate", searchKey],
    ],
    request(options),
  );
  const error = Object.values(errors)[0];
  if (error) throw error;
  await waitForNav(client, options);
}

export async function readNavInfo(client: FsapiClient, options: NavOptions = {}): Promise<NavInfo> {
  const { values } = await client.getMultiple(
    ["netRemote.nav.numItems", "netRemote.nav.depth"],
    request(options),
  );
  const numItems = values["netRemote.nav.numItems"];
  return {
    numItems: numItems !== undefined && numItems >= 0 ? numItems : undefined,
    depth: values["netRemote.nav.depth"],
  };
}

/** One page of the current menu, after `startKey` (-1 for the first page). */
export function readNavPage(
  client: FsapiClient,
  startKey = -1,
  options: NavOptions & { maxItems?: number } = {},
): Promise<ListPage<NavListItem>> {
  return client.listGetNext("netRemote.nav.list", {
    startKey,
    maxItems: options.maxItems ?? NAV_PAGE_SIZE,
    ...request(options),
  });
}
