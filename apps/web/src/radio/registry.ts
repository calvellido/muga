import { DEFAULT_PIN, type FetchLike, FsapiClient } from "@muga/fsapi-core";
import { RadioController, type RadioControllerOptions } from "./controller.ts";
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
  private snapshot: RegistrySnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly controllers = new Map<string, RadioController>();
  private readonly storage: StorageLike;
  private visible = true;
  /** The speakers of the group on screen, to find it again after it's built anew. */
  private groupSpeakers = new Set<string>();
  /** Per radio, what the multiroom list depends on: whether it answers, and its UDN. */
  private readonly seen = new Map<string, string>();

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
    this.multiroom.subscribe(() => this.followGroup());
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

  /** Pause polling while the page is hidden; resume (with an immediate refresh) when it's shown. */
  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    this.visible = visible;
    if (visible) this.start();
    else this.stop();
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

  /** A radio came online or reported its UDN: the multiroom list may now include it. */
  private radioChanged(id: string, controller: RadioController): void {
    const { connection, udn } = controller.getSnapshot();
    const key = `${connection}|${udn}`;
    if (this.seen.get(id) === key) return;
    this.seen.set(id, key);
    this.multiroom.radiosChanged();
    if (connection !== "online") return;
    // A speaker the list doesn't have yet (just connected, or back online): read it again now.
    const listed = this.multiroom.getSnapshot().status === "ready" && this.multiroom.speaker(id);
    if (!listed) void this.multiroom.refresh(true);
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
