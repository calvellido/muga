import type { FsapiClient, RequestOptions } from "./client.ts";
import { FsapiError } from "./errors.ts";

/**
 * Multiroom groups (`netRemote.multiroom.*`), as UNDOK runs them (Analysis doc 05 §6). A group
 * has one server, which streams to up to four clients. Every change is a SET on the server,
 * except handing the server role over, which is a SET on the speaker taking it.
 */

/** UNDOK builds a multiroom UDN from this and the last part of the speaker's UPnP UDN. */
export const MULTIROOM_UDN_PREFIX = "46C19E4A-472B-11E1-9F67-";

/** `multiroom.client.volume0..3`: four clients and the server, UNDOK's "maximum of 5". */
export const MAX_GROUP_CLIENTS = 4;

/** UNDOK's pauses after each step, in ms (doc 05 §6.3, §6.4). */
export const MULTIROOM_WAITS = {
  /** After `group.create`, before reading `group.id`. */
  create: 500,
  /** After `group.addClient`. */
  add: 1_000,
  /** After a client took the server role, before the old server is removed. */
  handOver: 4_000,
  /** After `group.destroy`. */
  destroy: 500,
};

export type GroupRole = "NO_GROUP" | "CLIENT" | "SERVER";
export type StereoRole = "INDEPENDENT" | "PRIMARY" | "SECONDARY";

/** One speaker of `multiroom.device.listAll`: every multiroom speaker the radio knows of. */
export interface MultiroomDevice {
  /** Multiroom UDN: the id that `addClient` and `removeClient` take. */
  udn: string;
  name: string;
  ip: string;
  /** Multiroom protocol; UNDOK only groups speakers whose versions match. */
  syncVersion: string;
  groupId: string;
  groupName: string;
  role: GroupRole;
  /** N of `multiroom.client.volumeN` / `muteN`, for a client. */
  clientNumber: number | undefined;
  /** Stereo pair membership (`multichannel.*`). */
  stereo: { id: string; role: StereoRole; name: string };
}

export interface MultiroomOptions extends RequestOptions {
  /** Overrides {@link MULTIROOM_WAITS} (tests use 0). */
  waits?: Partial<typeof MULTIROOM_WAITS>;
}

/** The radio refused a group change before anything was sent. */
export class MultiroomFailure extends FsapiError {
  readonly reason: "not-streamable";

  constructor(reason: "not-streamable") {
    super("status", "The current source can't be shared with other speakers", {
      node: "netRemote.multiroom.group.streamable",
    });
    this.reason = reason;
  }
}

export function isMultiroomFailure(error: unknown): error is MultiroomFailure {
  return error instanceof MultiroomFailure;
}

const GROUP_ROLES: readonly GroupRole[] = ["NO_GROUP", "CLIENT", "SERVER"];
const STEREO_ROLES: readonly StereoRole[] = ["INDEPENDENT", "PRIMARY", "SECONDARY"];

/** The last `-` part of a UDN, upper case: usually the speaker's MAC address. */
export function udnSuffix(udn: string): string {
  return (udn.trim().split("-").at(-1) ?? "").toUpperCase();
}

/** A speaker's multiroom UDN from its UPnP UDN, as UNDOK derives it (doc 05 §6.1). */
export function multiroomUdn(upnpUdn: string): string {
  const suffix = udnSuffix(upnpUdn.replace(/^uuid:/i, ""));
  return suffix ? `${MULTIROOM_UDN_PREFIX}${suffix}` : "";
}

function request(options: MultiroomOptions): RequestOptions {
  return options.signal ? { signal: options.signal } : {};
}

function pause(key: keyof typeof MULTIROOM_WAITS, options: MultiroomOptions): Promise<void> {
  const ms = options.waits?.[key] ?? MULTIROOM_WAITS[key];
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const signal = options.signal;
    if (signal?.aborted) return reject(new FsapiError("aborted", "Request aborted"));
    const onAbort = () => {
      clearTimeout(timer);
      reject(new FsapiError("aborted", "Request aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Every multiroom speaker the radio knows of, itself included (`multiroom.device.listAll`). */
export async function readMultiroomDevices(
  client: FsapiClient,
  options: RequestOptions = {},
): Promise<MultiroomDevice[]> {
  // UNDOK pages this list 30 at a time.
  const items = await client.listAllItems("netRemote.multiroom.device.listAll", {
    pageSize: 30,
    ...options,
  });
  return items.map((listed) => {
    // Older firmware may leave fields out (the stereo ones came later).
    const item: Partial<typeof listed> = listed;
    const text = (value: string | undefined) => value?.trim() ?? "";
    const role = GROUP_ROLES[item.GroupRole ?? 0] ?? "NO_GROUP";
    const number = item.ClientNumber;
    return {
      udn: text(item.UDN),
      name: text(item.FriendlyName),
      ip: text(item.IPAddress),
      syncVersion: text(item.AudioSyncVersion),
      groupId: text(item.GroupId),
      groupName: text(item.GroupName),
      role,
      clientNumber:
        role === "CLIENT" && number !== undefined && number < MAX_GROUP_CLIENTS
          ? number
          : undefined,
      stereo: {
        id: text(item.SystemId),
        role: STEREO_ROLES[item.SystemRole ?? 0] ?? "INDEPENDENT",
        name: text(item.SystemName),
      },
    };
  });
}

/**
 * Makes `server` the server of a new group, once its source can be shared
 * (`group.streamable`). Resolves with the new group id, or "" when the radio hasn't reported
 * it yet.
 */
export async function createGroup(
  server: FsapiClient,
  name: string,
  options: MultiroomOptions = {},
): Promise<string> {
  const streamable = await server.get("netRemote.multiroom.group.streamable", request(options));
  if (streamable !== "TRUE") throw new MultiroomFailure("not-streamable");
  await server.set("netRemote.multiroom.group.create", name, request(options));
  await pause("create", options);
  return (await server.get("netRemote.multiroom.group.id", request(options))).trim();
}

/** Adds a speaker to the server's group; it leaves any group it was in. */
export async function addToGroup(
  server: FsapiClient,
  clientUdn: string,
  options: MultiroomOptions = {},
): Promise<void> {
  await server.set("netRemote.multiroom.group.addClient", clientUdn, request(options));
  await pause("add", options);
}

export async function removeFromGroup(
  server: FsapiClient,
  clientUdn: string,
  options: MultiroomOptions = {},
): Promise<void> {
  await server.set("netRemote.multiroom.group.removeClient", clientUdn, request(options));
}

/** Ungroups every speaker of the server's group. */
export async function destroyGroup(
  server: FsapiClient,
  options: MultiroomOptions = {},
): Promise<void> {
  await server.set("netRemote.multiroom.group.destroy", "DESTROY", request(options));
  await pause("destroy", options);
}

/**
 * Lets the server leave a group that keeps playing: a client takes the server role
 * (`group.state` SERVER, UNDOK never uses `group.becomeServer`), then removes the old server.
 */
export async function handOverGroup(
  newServer: FsapiClient,
  oldServerUdn: string,
  options: MultiroomOptions = {},
): Promise<void> {
  await newServer.set("netRemote.multiroom.group.state", "SERVER", request(options));
  await pause("handOver", options);
  await newServer.set("netRemote.multiroom.group.removeClient", oldServerUdn, request(options));
}
