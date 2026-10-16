import {
  addToGroup,
  createGroup,
  destroyGroup,
  type FsapiClient,
  type GroupState,
  isFsapiError,
  MULTIROOM_UDN_PREFIX,
  type MultiroomDevice,
  type MultiroomOptions,
  multiroomUdn,
  readGroupState,
  readMultiroomDevices,
  removeFromGroup,
  udnSuffix,
} from "@muga/fsapi-core";
import type { RadioController } from "./controller.ts";
import type { ActionError, RadioConfig } from "./types.ts";

/** A speaker on the multiroom network. */
export interface MultiroomSpeaker extends MultiroomDevice {
  /** The saved speaker this is, if it's one of them. */
  radioId: string | undefined;
}

export interface MultiroomGroup {
  id: string;
  name: string;
  server: MultiroomSpeaker;
  /** In client-number order. */
  clients: MultiroomSpeaker[];
}

export type MultiroomTask = "create" | "edit" | "dissolve" | "leave";

const key = (udn: string) => udn.trim().toUpperCase();

export interface MultiroomSnapshot {
  /** unsupported: none of the saved speakers that answered has multiroom. */
  status: "idle" | "loading" | "ready" | "unsupported" | "error";
  /** Every multiroom speaker the network reports, saved or not. */
  speakers: MultiroomSpeaker[];
  groups: MultiroomGroup[];
  /** A group change is being applied. */
  busy: { task: MultiroomTask; groupId: string | undefined } | undefined;
  lastError: ActionError | undefined;
}

/** What the directory needs from the speaker registry. */
export interface MultiroomHost {
  radios(): readonly RadioConfig[];
  controller(id: string): RadioController | undefined;
  activeId(): string | undefined;
  /** A client for a speaker that isn't saved: by its address, with the default PIN. */
  clientAt(host: string): FsapiClient;
}

export interface MultiroomDirectoryOptions {
  /** How often each saved speaker's group state is read. Default 10 s. */
  intervalMs?: number;
  /** A speaker's list is read again after this long, even if its version didn't change. Default 60 s. */
  maxAgeMs?: number;
  /**
   * Wait after a change before reading the speakers again. Their own group nodes change at once
   * on real radios; this gives clients a moment to join. Default 1500 ms (UNDOK waits 3 s).
   */
  settleMs?: number;
  /** UNDOK's waits between the steps of a change (tests use 0). */
  waits?: MultiroomOptions["waits"];
  now?: () => number;
}

/** Radio ids and UDN ends compared without separators or case. */
function identity(id: string): string {
  const value = udnSuffix(id).replace(/[^0-9A-F]/g, "");
  return value.length >= 6 ? value : "";
}

/** `host[:port]` without scheme, path or the default port. */
function address(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:80$/, "");
}

/**
 * Which saved speaker a network entry is: by the end of its UDN (usually the MAC address,
 * which is what the radio id and UPnP UDN end with too), else by address.
 */
export function matchSpeaker(
  device: MultiroomDevice,
  radios: readonly { config: RadioConfig; udn: string }[],
): string | undefined {
  const id = identity(device.udn);
  const byId = id && radios.find((r) => [r.config.id, r.udn].some((x) => identity(x) === id));
  if (byId) return byId.config.id;
  const ip = address(device.ip);
  return ip ? radios.find((r) => address(r.config.host) === ip)?.config.id : undefined;
}

function toActionError(action: string, error: unknown, at: number): ActionError {
  return {
    action,
    kind: isFsapiError(error) ? error.kind : "unknown",
    message: error instanceof Error ? error.message : String(error),
    at,
  };
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/**
 * The multiroom network as the saved speakers see it (doc 05 §6.1, ADR 0008). On real radios:
 * - each speaker's `listAll` names the other speakers it knows of, not itself, and not always
 *   all of them, so the lists of every saved speaker are merged to find speakers;
 * - those lists lag behind group changes by up to a minute, while each speaker's own `group.*`
 *   nodes are right at once, so a saved speaker's group comes from its own nodes.
 * Unsaved speakers only appear in the lists, so their group is as fresh as the lists are.
 */
export class MultiroomDirectory {
  private snapshot: MultiroomSnapshot = {
    status: "idle",
    speakers: [],
    groups: [],
    busy: undefined,
    lastError: undefined,
  };
  private readonly listeners = new Set<() => void>();
  private readonly opts: Required<Omit<MultiroomDirectoryOptions, "waits">> & {
    waits: MultiroomOptions;
  };
  /** Per saved speaker that answered: its own group state and its list. */
  private readonly known = new Map<
    string,
    { own: GroupState; devices: MultiroomDevice[]; listedAt: number }
  >();
  /** Radios that answered without multiroom nodes. */
  private readonly without = new Set<string>();
  private running = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private current: Promise<void> | undefined;
  private forceNext = false;

  constructor(
    private readonly host: MultiroomHost,
    options: MultiroomDirectoryOptions = {},
  ) {
    this.opts = {
      intervalMs: options.intervalMs ?? 10_000,
      maxAgeMs: options.maxAgeMs ?? 60_000,
      settleMs: options.settleMs ?? 1_500,
      now: options.now ?? Date.now,
      waits: options.waits ? { waits: options.waits } : {},
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): MultiroomSnapshot => this.snapshot;

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule(0);
  }

  stop(): void {
    this.running = false;
    clearTimeout(this.timer);
  }

  /** Reads the speakers now; `force` reads their lists too, even if unchanged. */
  refresh(force = false): Promise<void> {
    if (this.current) {
      this.forceNext ||= force;
      return this.current.then(() => this.refresh(this.forceNext));
    }
    this.forceNext = false;
    this.current = this.load(force).finally(() => {
      this.current = undefined;
      this.schedule();
    });
    return this.current;
  }

  /** The saved speakers changed (connected, forgotten, or now reachable): map them again. */
  radiosChanged(): void {
    const ids = new Set(this.host.radios().map((r) => r.id));
    for (const id of this.without) if (!ids.has(id)) this.without.delete(id);
    for (const id of this.known.keys()) if (!ids.has(id)) this.known.delete(id);
    this.remap();
  }

  group(id: string | undefined): MultiroomGroup | undefined {
    return id ? this.snapshot.groups.find((g) => g.id === id) : undefined;
  }

  /** The group a saved speaker is in. */
  groupOf(radioId: string): MultiroomGroup | undefined {
    return this.snapshot.groups.find((g) =>
      [g.server, ...g.clients].some((s) => s.radioId === radioId),
    );
  }

  speaker(radioId: string): MultiroomSpeaker | undefined {
    return this.snapshot.speakers.find((s) => s.radioId === radioId);
  }

  nameTaken(name: string, exceptGroupId?: string): boolean {
    return this.snapshot.groups.some((g) => g.id !== exceptGroupId && g.name === name.trim());
  }

  clearError(): void {
    this.update({ lastError: undefined });
  }

  // Changes. Each resolves false when it failed (see `lastError`) or another one is running.

  /** A new group served by a saved speaker, with these speakers (by UDN) as its clients. */
  create(serverId: string, clientUdns: readonly string[], name: string): Promise<boolean> {
    const server = this.host.controller(serverId);
    if (!server) return Promise.resolve(false);
    return this.task("create", undefined, async () => {
      await createGroup(server.client, name.trim(), this.opts.waits);
      for (const udn of clientUdns) await addToGroup(server.client, udn, this.opts.waits);
    });
  }

  /**
   * Renames a group and sets its clients (by UDN); its server always stays. No clients left
   * ungroups it. A new name builds the group again on the same server, since `group.name` is
   * read-only (UNDOK does the same).
   *
   * The server can't leave a group that goes on: real radios don't hand the server role over,
   * and a speaker that was a client has no source, so it can't take clients either (ADR 0008).
   */
  edit(groupId: string, change: { name: string; clients: readonly string[] }): Promise<boolean> {
    const group = this.group(groupId);
    if (!group) return Promise.resolve(false);
    const serverKey = key(group.server.udn);
    const desired = new Set(change.clients.map(key).filter((udn) => udn !== serverKey));
    if (desired.size === 0) return this.dissolve(groupId);
    const name = change.name.trim() || group.name;
    return this.task("edit", groupId, async () => {
      const server = this.clientFor(group.server);
      if (name !== group.name) {
        await destroyGroup(server, this.opts.waits);
        await createGroup(server, name, this.opts.waits);
        for (const udn of desired) await addToGroup(server, udn, this.opts.waits);
        return;
      }
      const current = new Set(group.clients.map((c) => key(c.udn)));
      for (const udn of desired) {
        if (!current.has(udn)) await addToGroup(server, udn, this.opts.waits);
      }
      for (const client of group.clients) {
        if (!desired.has(key(client.udn)))
          await removeFromGroup(server, client.udn, this.opts.waits);
      }
    });
  }

  dissolve(groupId: string): Promise<boolean> {
    const group = this.group(groupId);
    if (!group) return Promise.resolve(false);
    return this.task("dissolve", groupId, () =>
      destroyGroup(this.clientFor(group.server), this.opts.waits),
    );
  }

  /** Takes a saved speaker out of its group; for its server, that ungroups everyone (see `edit`). */
  leave(radioId: string): Promise<boolean> {
    const group = this.groupOf(radioId);
    if (!group) return Promise.resolve(false);
    if (group.server.radioId === radioId) return this.dissolve(group.id);
    const client = group.clients.find((c) => c.radioId === radioId);
    if (!client) return Promise.resolve(false);
    return this.task("leave", group.id, () =>
      removeFromGroup(this.clientFor(group.server), client.udn, this.opts.waits),
    );
  }

  // Internals

  private clientFor(speaker: MultiroomSpeaker): FsapiClient {
    const controller = speaker.radioId ? this.host.controller(speaker.radioId) : undefined;
    return controller?.client ?? this.host.clientAt(speaker.ip);
  }

  private async task(
    task: MultiroomTask,
    groupId: string | undefined,
    run: () => Promise<void>,
  ): Promise<boolean> {
    if (this.snapshot.busy) return false;
    const before = new Set(this.snapshot.speakers.flatMap((s) => s.radioId ?? []));
    this.update({ busy: { task, groupId }, lastError: undefined });
    let ok = true;
    try {
      await run();
    } catch (error) {
      ok = false;
      this.update({ lastError: toActionError(task, error, this.opts.now()) });
    }
    // Whatever happened, show where the speakers ended up.
    await sleep(this.opts.settleMs);
    await this.refresh(true).catch(() => undefined);
    // Their sources and what they play changed too.
    for (const id of before) void this.host.controller(id)?.refreshNow();
    this.update({ busy: undefined });
    return ok;
  }

  private schedule(delay = this.opts.intervalMs): void {
    clearTimeout(this.timer);
    if (!this.running) return;
    this.timer = setTimeout(() => void this.refresh(), delay);
  }

  /** Saved speakers in the order their lists count: the selected one first. */
  private ordered(): string[] {
    const active = this.host.activeId();
    return this.host
      .radios()
      .map((r) => r.id)
      .sort((a, b) => Number(b === active) - Number(a === active));
  }

  private async load(force: boolean): Promise<void> {
    // Mid-change states show half-done groups; the change reads them itself when it's done.
    if (this.snapshot.busy && !force) return;
    const sources = this.ordered().flatMap((id) => {
      const controller = this.host.controller(id);
      const online = controller?.getSnapshot().connection === "online";
      return controller && online && !this.without.has(id) ? [controller] : [];
    });
    if (sources.length === 0) {
      if (this.host.radios().every((r) => this.without.has(r.id)) && this.without.size > 0) {
        this.update({ status: "unsupported", speakers: [], groups: [] });
      }
      return;
    }
    if (this.snapshot.status === "idle") this.update({ status: "loading" });
    let failure: unknown;
    await Promise.all(
      sources.map(async (source) => {
        const radioId = source.getSnapshot().config.id;
        try {
          const own = await readGroupState(source.client);
          if (!own) {
            this.without.add(radioId);
            this.known.delete(radioId);
            return;
          }
          const previous = this.known.get(radioId);
          const now = this.opts.now();
          const fresh =
            !force &&
            previous !== undefined &&
            previous.own.listVersion === own.listVersion &&
            now - previous.listedAt < this.opts.maxAgeMs;
          const devices = fresh ? previous.devices : await readMultiroomDevices(source.client);
          this.known.set(radioId, { own, devices, listedAt: fresh ? previous.listedAt : now });
        } catch (error) {
          if (isFsapiError(error, "status") && error.fsStatus === "FS_NODE_DOES_NOT_EXIST") {
            this.without.add(radioId);
            this.known.delete(radioId);
          } else {
            failure = error;
          }
        }
      }),
    );
    if (this.known.size === 0) {
      if (failure === undefined) this.update({ status: "unsupported", speakers: [], groups: [] });
      else if (this.snapshot.status !== "ready") this.update({ status: "error" });
      return;
    }
    this.remap();
  }

  private remap(): void {
    if (this.known.size === 0) return;
    const ids = this.ordered();
    const radios = this.host.radios().map((config) => ({
      config,
      udn: this.host.controller(config.id)?.getSnapshot().udn ?? "",
    }));
    const listed = ids.flatMap((id) => this.known.get(id)?.devices ?? []);
    const speakers = new Map<string, MultiroomSpeaker>();
    // Saved speakers that answered: their group from their own nodes.
    for (const radio of radios) {
      const own = this.known.get(radio.config.id)?.own;
      if (!own) continue;
      const entry = listed.find((d) => matchSpeaker(d, [radio]) !== undefined);
      const snapshot = this.host.controller(radio.config.id)?.getSnapshot();
      const udn =
        entry?.udn ||
        multiroomUdn(radio.udn) ||
        `${MULTIROOM_UDN_PREFIX}${identity(radio.config.id)}`;
      speakers.set(key(udn), {
        udn,
        name: snapshot?.name || entry?.name || radio.config.name,
        ip: entry?.ip || radio.config.host,
        syncVersion: own.syncVersion || entry?.syncVersion || "",
        groupId: own.groupId,
        groupName: own.groupName,
        role: own.role,
        clientNumber: own.clientNumber,
        stereo: entry?.stereo ?? { id: "", role: "INDEPENDENT", name: "" },
        radioId: radio.config.id,
      });
    }
    // Everyone else, from the lists (the selected speaker's first).
    for (const device of listed) {
      if (speakers.has(key(device.udn))) continue;
      const radioId = matchSpeaker(device, radios);
      if (radioId !== undefined && [...speakers.values()].some((s) => s.radioId === radioId)) {
        continue;
      }
      speakers.set(key(device.udn), { ...device, radioId });
    }
    const all = [...speakers.values()];
    const groups: MultiroomGroup[] = [];
    for (const speaker of all) {
      if (speaker.role !== "SERVER" || !speaker.groupId) continue;
      const clients = all
        .filter((s) => s !== speaker && s.role === "CLIENT" && s.groupId === speaker.groupId)
        .sort((a, b) => (a.clientNumber ?? 99) - (b.clientNumber ?? 99));
      groups.push({ id: speaker.groupId, name: speaker.groupName, server: speaker, clients });
    }
    const same =
      this.snapshot.status === "ready" &&
      JSON.stringify([all, groups]) ===
        JSON.stringify([this.snapshot.speakers, this.snapshot.groups]);
    if (!same) this.update({ status: "ready", speakers: all, groups });
  }

  private update(patch: Partial<MultiroomSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
}
