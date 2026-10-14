import { DEFAULT_PIN, type FetchLike, FsapiClient } from "@muga/fsapi-core";
import { RadioController, type RadioControllerOptions } from "./controller.ts";
import type { RadioConfig } from "./types.ts";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface RegistrySnapshot {
  radios: RadioConfig[];
  activeId: string | undefined;
}

export interface RadioRegistryOptions {
  storage?: StorageLike | undefined;
  fetch?: FetchLike;
  controller?: Omit<RadioControllerOptions, "fetch">;
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

/** Saved radios, the selected one, and one controller per radio. */
export class RadioRegistry {
  private snapshot: RegistrySnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly controllers = new Map<string, RadioController>();
  private readonly storage: StorageLike;
  private visible = true;

  constructor(private readonly options: RadioRegistryOptions = {}) {
    this.storage = safeStorage(options.storage);
    const radios = loadRadios(this.storage);
    const saved = this.storage.getItem(ACTIVE_KEY) ?? undefined;
    this.snapshot = {
      radios,
      activeId: radios.some((r) => r.id === saved) ? saved : radios[0]?.id,
    };
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
  }

  stop(): void {
    for (const controller of this.controllers.values()) controller.stop();
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

  /** Probes and saves a radio. Adding a radio that's already saved updates its host and PIN. */
  async add(host: string, pin = DEFAULT_PIN): Promise<RadioConfig> {
    const config = await this.probe(host, pin);
    const existing = this.snapshot.radios.find((r) => r.id === config.id);
    if (existing) this.dropController(existing.id);
    const previous = this.snapshot.activeId;
    const radios = existing
      ? this.snapshot.radios.map((r) => (r.id === config.id ? config : r))
      : [...this.snapshot.radios, config];
    this.commit({ radios, activeId: config.id });
    if (previous !== config.id) this.controllers.get(previous ?? "")?.setActive(false);
    if (this.visible) this.start();
    return config;
  }

  remove(id: string): void {
    this.dropController(id);
    const radios = this.snapshot.radios.filter((r) => r.id !== id);
    const activeId = this.snapshot.activeId === id ? radios[0]?.id : this.snapshot.activeId;
    this.commit({ radios, activeId });
    this.controller(activeId)?.setActive(true);
  }

  select(id: string): void {
    if (id === this.snapshot.activeId || !this.snapshot.radios.some((r) => r.id === id)) return;
    this.controller(this.snapshot.activeId)?.setActive(false);
    this.commit({ ...this.snapshot, activeId: id });
    const controller = this.controller(id);
    if (this.visible) controller?.start(true);
    controller?.setActive(true);
  }

  updatePin(id: string, pin: string): void {
    const radios = this.snapshot.radios.map((r) => (r.id === id ? { ...r, pin } : r));
    this.commit({ ...this.snapshot, radios });
    this.controllers.get(id)?.setPin(pin);
  }

  private dropController(id: string): void {
    this.controllers.get(id)?.stop();
    this.controllers.delete(id);
  }

  private commit(snapshot: RegistrySnapshot): void {
    this.snapshot = snapshot;
    this.storage.setItem(RADIOS_KEY, JSON.stringify(snapshot.radios));
    if (snapshot.activeId) this.storage.setItem(ACTIVE_KEY, snapshot.activeId);
    for (const listener of this.listeners) listener();
  }
}
