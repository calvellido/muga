import {
  addToGroup,
  createGroup,
  destroyGroup,
  type FsapiClient,
  handOverGroup,
  isFsapiError,
  MAX_GROUP_CLIENTS,
  MULTIROOM_UDN_PREFIX,
  type MultiroomDevice,
  type MultiroomOptions,
  multiroomUdn,
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
  connect(host: string): FsapiClient;
}

export interface MultiroomDirectoryOptions {
  /** How often the speaker list's version is checked. Default 10 s. */
  intervalMs?: number;
  /** The list is read again anyway after this long. Default 60 s. */
  maxAgeMs?: number;
  /**
   * Wait after a change before reading the list again: radios update it in the background.
   * UNDOK waits 3 s. Default 3000 ms.
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
 * The multiroom network as the saved speakers see it: any one of them lists every multiroom
 * speaker with its group (`multiroom.device.listAll`, doc 05 §6.1). It's read from the selected
 * speaker when it can, and again whenever its version changes.
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
  private devices: MultiroomDevice[] = [];
  private read: { radioId: string; version: number; at: number } | undefined;
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
      settleMs: options.settleMs ?? 3_000,
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

  /** Reads the speaker list now; `force` even when its version hasn't changed. */
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

  /** The saved speakers changed (added, removed, or now reachable): map the list again. */
  radiosChanged(): void {
    const ids = new Set(this.host.radios().map((r) => r.id));
    for (const id of this.without) if (!ids.has(id)) this.without.delete(id);
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
   * Renames a group and changes its speakers (by UDN, the server included while it stays).
   * A new name means building the group again, since `group.name` is read-only: UNDOK does the
   * same. A server leaving hands its role to the first remaining speaker. Fewer than two
   * speakers ungroups them.
   */
  edit(groupId: string, change: { name: string; members: readonly string[] }): Promise<boolean> {
    const group = this.group(groupId);
    if (!group) return Promise.resolve(false);
    const key = (udn: string) => udn.trim().toUpperCase();
    const desired = new Set(change.members.map(key));
    if (desired.size < 2) return this.dissolve(groupId);
    const serverUdn = key(group.server.udn);
    const name = change.name.trim() || group.name;
    return this.task("edit", groupId, async () => {
      const server = this.clientFor(group.server);
      const current = new Set([serverUdn, ...group.clients.map((c) => key(c.udn))]);
      const renamed = name !== group.name;
      if (renamed) {
        await destroyGroup(server, this.opts.waits);
        await createGroup(server, name, this.opts.waits);
        for (const udn of desired) {
          if (udn !== serverUdn) await addToGroup(server, udn, this.opts.waits);
        }
      } else {
        for (const udn of desired) {
          if (!current.has(udn)) await addToGroup(server, udn, this.opts.waits);
        }
        for (const client of group.clients) {
          if (!desired.has(key(client.udn)))
            await removeFromGroup(server, client.udn, this.opts.waits);
        }
      }
      if (!desired.has(serverUdn)) {
        const nextUdn = [...group.clients.map((c) => key(c.udn)), ...desired].find(
          (udn) => udn !== serverUdn && desired.has(udn),
        );
        const next = this.snapshot.speakers.find((s) => key(s.udn) === nextUdn);
        if (!next) throw new Error("No speaker left to take over the group");
        await handOverGroup(this.clientFor(next), group.server.udn, this.opts.waits);
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

  /** Takes a saved speaker out of its group. A server hands over to a client, or ungroups. */
  leave(radioId: string): Promise<boolean> {
    const group = this.groupOf(radioId);
    if (!group) return Promise.resolve(false);
    const server = this.clientFor(group.server);
    if (group.server.radioId !== radioId) {
      const client = group.clients.find((c) => c.radioId === radioId);
      if (!client) return Promise.resolve(false);
      return this.task("leave", group.id, () =>
        removeFromGroup(server, client.udn, this.opts.waits),
      );
    }
    const [next, ...others] = group.clients;
    if (!next || others.length === 0) return this.dissolve(group.id);
    return this.task("leave", group.id, () =>
      handOverGroup(this.clientFor(next), group.server.udn, this.opts.waits),
    );
  }

  // Internals

  private clientFor(speaker: MultiroomSpeaker): FsapiClient {
    const controller = speaker.radioId ? this.host.controller(speaker.radioId) : undefined;
    return controller?.client ?? this.host.connect(speaker.ip);
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

  /** Saved speakers to read the list from: online ones with multiroom, the selected first. */
  private sources(): RadioController[] {
    const active = this.host.activeId();
    const ids = this.host
      .radios()
      .map((r) => r.id)
      .sort((a, b) => Number(b === active) - Number(a === active));
    return ids.flatMap((id) => {
      const controller = this.host.controller(id);
      return controller && !this.without.has(id) && controller.getSnapshot().connection === "online"
        ? [controller]
        : [];
    });
  }

  private async load(force: boolean): Promise<void> {
    // Mid-change lists show half-done groups; the change reads the list itself when it's done.
    if (this.snapshot.busy && !force) return;
    const sources = this.sources();
    if (sources.length === 0) {
      if (this.host.radios().every((r) => this.without.has(r.id)) && this.without.size > 0) {
        this.update({ status: "unsupported", speakers: [], groups: [] });
      }
      return;
    }
    if (this.snapshot.status === "idle") this.update({ status: "loading" });
    let failure: unknown;
    for (const source of sources) {
      const radioId = source.getSnapshot().config.id;
      try {
        const version = await source.client.get("netRemote.multiroom.device.listAllVersion");
        const fresh =
          this.read?.radioId === radioId &&
          this.read.version === version &&
          this.opts.now() - this.read.at < this.opts.maxAgeMs;
        if (fresh && !force && this.snapshot.status === "ready") return this.remap();
        this.devices = await this.withSelf(source, await readMultiroomDevices(source.client));
        this.read = { radioId, version, at: this.opts.now() };
        return this.remap();
      } catch (error) {
        if (isFsapiError(error, "status") && error.fsStatus === "FS_NODE_DOES_NOT_EXIST") {
          this.without.add(radioId);
        } else {
          failure = error;
        }
      }
    }
    if (failure === undefined) {
      this.devices = [];
      this.update({ status: "unsupported", speakers: [], groups: [] });
    } else if (this.snapshot.status !== "ready") {
      this.update({ status: "error" });
    }
  }

  /**
   * Adds the radio that was asked when its own list leaves it out (whether real radios list
   * themselves is unverified), from its `group.*` nodes.
   */
  private async withSelf(
    source: RadioController,
    devices: MultiroomDevice[],
  ): Promise<MultiroomDevice[]> {
    const { config, udn, name } = source.getSnapshot();
    if (devices.some((d) => matchSpeaker(d, [{ config, udn }]) !== undefined)) return devices;
    const { values } = await source.client.getMultiple([
      "netRemote.multiroom.group.state",
      "netRemote.multiroom.group.id",
      "netRemote.multiroom.group.name",
      "netRemote.multiroom.device.clientIndex",
    ]);
    const role = values["netRemote.multiroom.group.state"];
    const index = values["netRemote.multiroom.device.clientIndex"];
    const self: MultiroomDevice = {
      udn: multiroomUdn(udn) || `${MULTIROOM_UDN_PREFIX}${identity(config.id)}`,
      name,
      ip: config.host,
      syncVersion: "",
      groupId: values["netRemote.multiroom.group.id"]?.trim() ?? "",
      groupName: values["netRemote.multiroom.group.name"]?.trim() ?? "",
      role: role === "CLIENT" || role === "SERVER" ? role : "NO_GROUP",
      clientNumber:
        role === "CLIENT" && index !== undefined && index < MAX_GROUP_CLIENTS ? index : undefined,
      stereo: { id: "", role: "INDEPENDENT", name: "" },
    };
    return [self, ...devices];
  }

  private remap(): void {
    if (this.read === undefined) return;
    const radios = this.host.radios().map((config) => ({
      config,
      udn: this.host.controller(config.id)?.getSnapshot().udn ?? "",
    }));
    const speakers: MultiroomSpeaker[] = this.devices.map((device) => ({
      ...device,
      radioId: matchSpeaker(device, radios),
    }));
    const groups: MultiroomGroup[] = [];
    for (const speaker of speakers) {
      if (speaker.role !== "SERVER" || !speaker.groupId) continue;
      const clients = speakers
        .filter((s) => s !== speaker && s.groupId === speaker.groupId)
        .sort((a, b) => (a.clientNumber ?? 99) - (b.clientNumber ?? 99));
      groups.push({ id: speaker.groupId, name: speaker.groupName, server: speaker, clients });
    }
    const same =
      this.snapshot.status === "ready" &&
      JSON.stringify([speakers, groups]) ===
        JSON.stringify([this.snapshot.speakers, this.snapshot.groups]);
    if (!same) this.update({ status: "ready", speakers, groups });
  }

  private update(patch: Partial<MultiroomSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }
}
