import { DEFAULT_PIN, type FetchLike, FsapiClient } from "@muga/fsapi-core";
import { RadioController, type RadioControllerOptions } from "./controller.ts";
import { type FinderOptions, SpeakerFinder } from "./finder.ts";
import {
  MultiroomDirectory,
  type MultiroomDirectoryOptions,
  type MultiroomGroup,
} from "./multiroom.ts";
import type { RadioConfig } from "./types.ts";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface RegistrySnapshot {
  radios: RadioConfig[];
  activeId: string | undefined;
  /** A multiroom group is on screen; `activeId` is then its server. */
  activeGroupId: string | undefined;
}

export interface RadioRegistryOptions {
  storage?: StorageLike | undefined;
  fetch?: FetchLike;
  controller?: Omit<RadioControllerOptions, "fetch">;
  multiroom?: MultiroomDirectoryOptions;
  finder?: Omit<FinderOptions, "fetch">;
  /** How often an unreachable speaker is looked for again on its own. Default 60 s. */
  relocateEveryMs?: number;
}

/** What `sys.info.radioId` looks like: the radio's MAC address. Speakers saved by host have none. */
const RADIO_ID = /^[0-9A-F]{12}$/i;

/** `host[:port]` without scheme, path or the default port, to compare addresses. */
export function address(host: string): string {
  return host
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:80$/, "");
}

/** The first result that isn't undefined, or undefined once all are in. */
function firstFound(searches: Promise<string | undefined>[]): Promise<string | undefined> {
  if (searches.length === 0) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    let left = searches.length;
    const settle = (value: string | undefined) => {
      if (value) resolve(value);
      else if (--left === 0) resolve(undefined);
    };
    for (const search of searches) search.then(settle, () => settle(undefined));
  });
}

/** The `.local` name a radio advertises: its name, spaces as hyphens (seen on three models). */
export function localName(name: string): string | undefined {
  const trimmed = name.trim();
  return /^[A-Za-z0-9][A-Za-z0-9 -]*$/.test(trimmed)
    ? `${trimmed.replace(/\s+/g, "-")}.local`
    : undefined;
}

const RADIOS_KEY = "muga.radios.v1";
const ACTIVE_KEY = "muga.activeRadio.v1";

/** localStorage can be missing or throw (private browsing, blocked storage): never let that break the app. */
function safeStorage(storage: StorageLike | undefined): StorageLike {
  return {
    getItem: (key) => {
      try {
        return storage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    setItem: (key, value) => {
      try {
        storage?.setItem(key, value);
      } catch {
        // Persisting is best-effort.
      }
    },
  };
}

function loadRadios(storage: StorageLike): RadioConfig[] {
  try {
    const parsed: unknown = JSON.parse(storage.getItem(RADIOS_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is RadioConfig =>
        typeof r?.id === "string" && typeof r?.host === "string" && typeof r?.pin === "string",
    );
  } catch {
    return [];
  }
}

/** Saved radios, the selected one (or group), one controller per radio, and multiroom groups. */
export class RadioRegistry {
  readonly multiroom: MultiroomDirectory;
  /** Finds radios on the network when asked to (ADR 0011). */
  readonly finder: SpeakerFinder;
  private snapshot: RegistrySnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly controllers = new Map<string, RadioController>();
  private readonly storage: StorageLike;
  private visible = true;
  /** The speakers of the group on screen, to find it again after it's built anew. */
  private groupSpeakers = new Set<string>();
  /** Per radio, what the multiroom list depends on: whether it answers, and its UDN. */
  private readonly seen = new Map<string, string>();
  /** Searches for speakers that stopped answering, and when each was last looked for. */
  private readonly searches = new Map<string, Promise<boolean>>();
  private readonly searched = new Map<string, number>();
  /** The address from the multiroom lists last tried for each speaker. */
  private readonly tried = new Map<string, string>();

  constructor(private readonly options: RadioRegistryOptions = {}) {
    this.storage = safeStorage(options.storage);
    const radios = loadRadios(this.storage);
    const saved = this.storage.getItem(ACTIVE_KEY) ?? undefined;
    this.snapshot = {
      radios,
      activeId: radios.some((r) => r.id === saved) ? saved : radios[0]?.id,
      activeGroupId: undefined,
    };
    this.multiroom = new MultiroomDirectory(
      {
        radios: () => this.snapshot.radios,
        controller: (id) => this.controller(id),
        activeId: () => this.snapshot.activeId,
        clientAt: (host) =>
          new FsapiClient({
            host,
            pin: DEFAULT_PIN,
            ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
          }),
      },
      options.multiroom,
    );
    this.multiroom.subscribe(() => {
      this.followGroup();
      this.followAddresses();
    });
    this.finder = new SpeakerFinder(
      { radios: () => this.snapshot.radios },
      { ...options.finder, ...(options.fetch ? { fetch: options.fetch } : {}) },
    );
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): RegistrySnapshot => this.snapshot;

  /** Starts polling every saved radio (the selected one at the fast rate). */
  start(): void {
    for (const radio of this.snapshot.radios)
      this.controller(radio.id)?.start(radio.id === this.snapshot.activeId);
    this.multiroom.start();
  }

  stop(): void {
    for (const controller of this.controllers.values()) controller.stop();
    this.multiroom.stop();
  }

  /**
   * While the page is hidden, polling pauses, except for the speaker on screen, read slowly for
   * the page's title. Shown again, everything resumes with an immediate refresh.
   */
  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    for (const controller of this.controllers.values()) controller.setHidden(!visible);
    if (visible) this.start();
    else this.multiroom.stop();
  }

  controller(id: string | undefined): RadioController | undefined {
    if (!id) return undefined;
    const existing = this.controllers.get(id);
    if (existing) return existing;
    const config = this.snapshot.radios.find((r) => r.id === id);
    if (!config) return undefined;
    const controller = new RadioController(config, {
      ...this.options.controller,
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
    });
    this.controllers.set(id, controller);
    controller.setHidden(!this.visible);
    controller.subscribe(() => this.radioChanged(id, controller));
    return controller;
  }

  /**
   * Checks that `host` answers FSAPI with this PIN and returns its identity.
   * Rejects with an FsapiError (`pin`, `network`, `timeout`, `parse`, …) otherwise.
   */
  async probe(host: string, pin = DEFAULT_PIN): Promise<RadioConfig> {
    const client = new FsapiClient({
      host,
      pin,
      timeoutMs: 6_000,
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
    });
    const { values } = await client.getMultiple([
      "netRemote.sys.info.friendlyName",
      "netRemote.sys.info.radioId",
    ]);
    const name = values["netRemote.sys.info.friendlyName"];
    if (name === undefined) {
      // The radio answered but without a name: still prove it speaks FSAPI.
      await client.get("netRemote.sys.info.friendlyName");
    }
    const radioId = values["netRemote.sys.info.radioId"]?.trim();
    return {
      id: radioId || host.trim(),
      host: host.trim(),
      pin,
      name: name?.trim() || host.trim(),
    };
  }

  /**
   * Connects a speaker: probes it and saves it to the speaker list. Connecting one that's already
   * saved updates its host and PIN.
   */
  async connect(host: string, pin = DEFAULT_PIN): Promise<RadioConfig> {
    const config = await this.probe(host, pin);
    const existing = this.snapshot.radios.find((r) => r.id === config.id);
    if (existing) this.dropController(existing.id);
    const previous = this.snapshot.activeId;
    const radios = existing
      ? this.snapshot.radios.map((r) => (r.id === config.id ? config : r))
      : [...this.snapshot.radios, config];
    this.leaveGroupView();
    this.commit({ radios, activeId: config.id, activeGroupId: undefined });
    if (previous !== config.id) this.controllers.get(previous ?? "")?.setActive(false);
    if (this.visible) this.start();
    this.multiroom.radiosChanged();
    return config;
  }

  /** Forgets a speaker: takes it off the speaker list. */
  forget(id: string): void {
    this.leaveGroupView();
    this.dropController(id);
    const radios = this.snapshot.radios.filter((r) => r.id !== id);
    const activeId = this.snapshot.activeId === id ? radios[0]?.id : this.snapshot.activeId;
    this.commit({ radios, activeId, activeGroupId: undefined });
    this.controller(activeId)?.setActive(true);
    this.multiroom.radiosChanged();
  }

  select(id: string): void {
    if (!this.snapshot.radios.some((r) => r.id === id)) return;
    if (id === this.snapshot.activeId && !this.snapshot.activeGroupId) return;
    this.leaveGroupView();
    this.activate(id, undefined);
  }

  /** Shows a multiroom group: its server becomes the selected radio. */
  selectGroup(groupId: string): void {
    const serverId = this.multiroom.group(groupId)?.server.radioId;
    if (!serverId || !this.snapshot.radios.some((r) => r.id === serverId)) return;
    if (serverId === this.snapshot.activeId && groupId === this.snapshot.activeGroupId) return;
    if (serverId !== this.snapshot.activeId) this.leaveGroupView();
    const group = this.multiroom.group(groupId);
    if (group) this.groupSpeakers = new Set([group.server, ...group.clients].map((s) => s.udn));
    this.activate(serverId, groupId);
    this.controller(serverId)?.setGroupServer(true);
  }

  /** Shows the group a saved speaker serves or belongs to, if any. */
  selectGroupOf(radioId: string): void {
    const group = this.multiroom.groupOf(radioId);
    if (group) this.selectGroup(group.id);
  }

  updatePin(id: string, pin: string): void {
    const radios = this.snapshot.radios.map((r) => (r.id === id ? { ...r, pin } : r));
    this.commit({ ...this.snapshot, radios });
    this.controllers.get(id)?.setPin(pin);
  }

  /**
   * Finds a saved speaker that stopped answering at its address, for example after the router
   * gave it another one (ADR 0011). It looks for the same radio id in the other speakers'
   * multiroom lists and at the speaker's `.local` name, and, with `scan`, on the whole network.
   * Resolves true when found; its saved address is then updated.
   */
  relocate(
    id: string,
    { scan = false, hint = false }: { scan?: boolean; hint?: boolean } = {},
  ): Promise<boolean> {
    const running = this.searches.get(id);
    if (running && !scan && !hint) return running;
    // A scan someone asked for, or a new address to try, doesn't wait for a search under way.
    const search: Promise<boolean> = this.search(id, scan, hint).finally(() => {
      if (this.searches.get(id) === search) this.searches.delete(id);
    });
    this.searches.set(id, search);
    return search;
  }

  /** Keeps the saved name in step after the radio was renamed (shown while it's offline). */
  rename(id: string, name: string): void {
    const radios = this.snapshot.radios.map((r) => (r.id === id ? { ...r, name } : r));
    this.commit({ ...this.snapshot, radios });
  }

  private activate(id: string, activeGroupId: string | undefined): void {
    const previous = this.snapshot.activeId;
    if (previous !== id) this.controller(previous)?.setActive(false);
    this.commit({ ...this.snapshot, activeId: id, activeGroupId });
    const controller = this.controller(id);
    if (this.visible) controller?.start(true);
    controller?.setActive(true);
  }

  private leaveGroupView(): void {
    if (this.snapshot.activeGroupId) this.controller(this.snapshot.activeId)?.setGroupServer(false);
  }

  /**
   * Keeps a group on screen through changes. A rename, or its server leaving, builds the group
   * again with a new id (and server): the view moves to the group with most of the same speakers.
   */
  private followGroup(): void {
    const { activeGroupId } = this.snapshot;
    const directory = this.multiroom.getSnapshot();
    if (!activeGroupId || directory.busy || directory.status !== "ready") return;
    const udns = (g: MultiroomGroup) => [g.server, ...g.clients].map((s) => s.udn);
    const group =
      this.multiroom.group(activeGroupId) ??
      directory.groups
        .map((g) => ({ g, shared: udns(g).filter((u) => this.groupSpeakers.has(u)).length }))
        .filter(({ shared }) => shared > 0)
        .sort((a, b) => b.shared - a.shared)[0]?.g;
    const serverId = group?.server.radioId;
    if (!group || !serverId || !this.snapshot.radios.some((r) => r.id === serverId)) {
      this.leaveGroupView();
      this.groupSpeakers = new Set();
      this.commit({ ...this.snapshot, activeGroupId: undefined });
      return;
    }
    this.groupSpeakers = new Set(udns(group));
    if (group.id !== activeGroupId || serverId !== this.snapshot.activeId)
      this.selectGroup(group.id);
  }

  /**
   * A radio came online, reported its UDN, or changed source or power. The multiroom state may
   * have changed with it: in a group, a client choosing a source leads the group, and standby on
   * any speaker takes the whole group with it (ADR 0008).
   */
  private radioChanged(id: string, controller: RadioController): void {
    const { connection, udn, modeKey, power } = controller.getSnapshot();
    const key = `${connection}|${udn}|${modeKey}|${power}`;
    const was = this.seen.get(id);
    if (was === key) return;
    this.seen.set(id, key);
    this.multiroom.radiosChanged();
    // It stopped answering: perhaps it has another address now.
    if (connection === "offline" && !was?.startsWith("offline|")) void this.relocate(id);
    if (connection !== "online") return;
    // A speaker the lists don't have yet (just connected, or back online): read them too.
    const listed = this.multiroom.getSnapshot().status === "ready" && this.multiroom.speaker(id);
    void this.multiroom.refresh(!listed);
  }

  /** An unreachable speaker that the multiroom lists show at another address: try it there. */
  private followAddresses(): void {
    for (const config of this.snapshot.radios) {
      if (this.controllers.get(config.id)?.getSnapshot().connection !== "offline") continue;
      const listed = this.multiroom.speaker(config.id)?.ip;
      if (!listed || address(listed) === address(config.host)) continue;
      if (this.tried.get(config.id) === address(listed)) continue;
      this.tried.set(config.id, address(listed));
      void this.relocate(config.id, { hint: true });
    }
  }

  private async search(id: string, scan: boolean, hint: boolean): Promise<boolean> {
    const config = this.snapshot.radios.find((r) => r.id === id);
    if (!config || !RADIO_ID.test(config.id)) return false;
    const now = Date.now();
    const every = this.options.relocateEveryMs ?? 60_000;
    if (!scan && !hint && now - (this.searched.get(id) ?? 0) < every) return false;
    this.searched.set(id, now);
    const name = this.controllers.get(id)?.getSnapshot().name || config.name;
    const candidates = [
      ...this.multiroom
        .getSnapshot()
        .speakers.filter((s) => s.radioId === id && s.ip)
        .map((s) => s.ip),
      localName(name) ?? "",
    ].filter((host) => host && address(host) !== address(config.host));
    // All at once, with the scan when asked for: the first place the radio answers wins.
    const host = await firstFound([
      ...[...new Set(candidates)].map(async (h) =>
        (await this.answersAs(h, config)) ? h : undefined,
      ),
      ...(scan ? [this.finder.locate(config.id, config.pin).then((found) => found?.host)] : []),
    ]);
    return host ? this.moveTo(id, host) : false;
  }

  /** Whether the radio answering at `host` is this one. */
  private async answersAs(host: string, config: RadioConfig): Promise<boolean> {
    const client = new FsapiClient({
      host,
      pin: config.pin,
      timeoutMs: 3_000,
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
    });
    try {
      const radioId = await client.get("netRemote.sys.info.radioId");
      return radioId.trim().toUpperCase() === config.id.toUpperCase();
    } catch {
      return false;
    }
  }

  /** Saves a speaker's new address and starts talking to it there. */
  private moveTo(id: string, host: string): boolean {
    // Another search may have got there first.
    const current = this.snapshot.radios.find((r) => r.id === id)?.host;
    if (current !== undefined && address(current) === address(host)) return true;
    const active = this.snapshot.activeId === id;
    const serving = active && this.snapshot.activeGroupId !== undefined;
    const radios = this.snapshot.radios.map((r) => (r.id === id ? { ...r, host } : r));
    this.dropController(id);
    this.commit({ ...this.snapshot, radios });
    const controller = this.controller(id);
    if (this.visible) controller?.start(active);
    if (serving) controller?.setGroupServer(true);
    this.multiroom.radiosChanged();
    return true;
  }

  private dropController(id: string): void {
    this.controllers.get(id)?.stop();
    this.controllers.delete(id);
    this.seen.delete(id);
  }

  private commit(snapshot: RegistrySnapshot): void {
    this.snapshot = snapshot;
    this.storage.setItem(RADIOS_KEY, JSON.stringify(snapshot.radios));
    if (snapshot.activeId) this.storage.setItem(ACTIVE_KEY, snapshot.activeId);
    for (const listener of this.listeners) listener();
  }
}
