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

/**
 * Where `nav.status` settled. "OFF": the radio answers FS_NODE_BLOCKED because navigation is
 * off (seen on an ICD2018, V2.13.21c, whenever `nav.state` is OFF, including in standby).
 */
export type SettledNavStatus = ReadyStatus | "FAIL" | "FATAL_ERR" | "OFF";

const STATUS_NODE = "netRemote.nav.status";
/** First polls come quickly: a radio usually settles in a few hundred ms. */
const FIRST_POLL_MS = 100;

function isReady(status: unknown): status is ReadyStatus {
  return status === "READY" || status === "READY_ROOT";
}

/** `nav.status` ended up somewhere other than READY / READY_ROOT, or never settled. */
export class NavFailure extends FsapiError {
  readonly navStatus: SettledNavStatus | "TIMEOUT";

  constructor(navStatus: SettledNavStatus | "TIMEOUT") {
    super(
      navStatus === "TIMEOUT" ? "timeout" : "status",
      navStatus === "TIMEOUT"
        ? "Navigation did not become ready"
        : `Navigation failed (${navStatus})`,
      { node: STATUS_NODE },
    );
    this.navStatus = navStatus;
  }
}

export function isNavFailure(error: unknown): error is NavFailure {
  return error instanceof NavFailure;
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

async function readStatus(
  client: FsapiClient,
  options: NavOptions,
): Promise<SettledNavStatus | "WAITING"> {
  try {
    const status = await client.get(STATUS_NODE, request(options));
    return typeof status === "string" ? status : "FAIL";
  } catch (error) {
    if (isFsapiError(error, "status") && error.fsStatus === "FS_NODE_BLOCKED") return "OFF";
    throw error;
  }
}

/** Polls `nav.status` while it reads WAITING and returns where it settled. Never throws for FAIL. */
export async function settleNav(
  client: FsapiClient,
  options: NavOptions = {},
): Promise<SettledNavStatus> {
  const pollMs = options.pollMs ?? 500;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const start = Date.now();
  for (let attempt = 0; ; attempt++) {
    const status = await readStatus(client, options);
    if (status !== "WAITING") return status;
    if (Date.now() - start >= timeoutMs) throw new NavFailure("TIMEOUT");
    await sleep(Math.min(pollMs, FIRST_POLL_MS * 2 ** attempt), options.signal);
  }
}

/** Waits until the menu is ready; anything else is a {@link NavFailure}. */
export async function waitForNav(
  client: FsapiClient,
  options: NavOptions = {},
): Promise<ReadyStatus> {
  const status = await settleNav(client, options);
  if (isReady(status)) return status;
  throw new NavFailure(status);
}

/**
 * Turns navigation on unless it's ready or busy, then waits while WAITING, like UNDOK's
 * ensureNavReady. Keeps the menu position. Returns where the status settled without throwing:
 * a source without a menu reports FATAL_ERR, yet its presets can still be read.
 */
export async function enableNav(
  client: FsapiClient,
  options: NavOptions = {},
): Promise<SettledNavStatus> {
  const status = await readStatus(client, options);
  if (isReady(status)) return status;
  if (status !== "WAITING") await client.set("netRemote.nav.state", "ON", request(options));
  return settleNav(client, options);
}

/** `nav.state` OFF then ON: back to the current source's top menu. */
export async function resetNav(client: FsapiClient, options: NavOptions = {}): Promise<void> {
  await client.set("netRemote.nav.state", "OFF", request(options));
  await client.set("netRemote.nav.state", "ON", request(options));
  await waitForNav(client, options);
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
