import { ensureNavReady, isFsapiError } from "@muga/fsapi-core";
import { hasCap, NavCap, PlayCap } from "./caps.ts";
import type { Preset, PresetsState, RadioContext, RadioSnapshot } from "./types.ts";

export interface PresetAbilities {
  /** Save what's playing into a slot (`play.caps` AddPreset). */
  store: boolean;
  /** Clear a slot (`nav.caps` PresetsEdition, unless the radio said otherwise). */
  remove: boolean;
  /**
   * Swap slots with LIST_SET. Only when every stored preset carries the `url` field UNDOK sends
   * back: rewriting a preset without it would leave a slot that can't play.
   */
  reorder: boolean;
}

export function presetAbilities({ navCaps, play, presets }: RadioSnapshot): PresetAbilities {
  const editable = hasCap(navCaps, NavCap.PresetsEdition);
  const stored = presets.items.filter((p) => p.name);
  return {
    store: hasCap(play.caps, PlayCap.AddPreset),
    remove: editable && !presets.deleteUnsupported,
    reorder: editable && stored.length > 0 && stored.every((p) => presetUrl(p) !== ""),
  };
}

function presetUrl(preset: Preset): string {
  return typeof preset.url === "string" ? preset.url : "";
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Preset list for the current source: load, recall, store, delete and reorder (doc 05 §4). */
export class PresetManager {
  constructor(private readonly ctx: RadioContext) {}

  private get state(): PresetsState {
    return this.ctx.snapshot().presets;
  }

  private set(patch: Partial<PresetsState>): void {
    this.ctx.update({ presets: { ...this.state, ...patch } });
  }

  async load(): Promise<void> {
    const { client } = this.ctx;
    if (this.ctx.snapshot().power === false) {
      this.set({ status: "standby", items: [] });
      return;
    }
    this.set({ status: "loading" });
    try {
      const navCaps = await client.get("netRemote.nav.caps").catch((error: unknown) => {
        if (isFsapiError(error, "status")) return undefined;
        throw error;
      });
      this.ctx.update({ navCaps });
      if (navCaps !== undefined && !hasCap(navCaps, NavCap.Presets)) {
        this.set({ status: "unsupported", items: [] });
        return;
      }
      this.set({ status: "ready", items: await this.read() });
    } catch (error) {
      if (isFsapiError(error, "status") && error.fsStatus === "FS_NODE_DOES_NOT_EXIST") {
        this.set({ status: "unsupported", items: [] });
      } else {
        this.set({ status: "error", items: [] });
        this.ctx.fail("presets", error);
      }
    }
  }

  select(key: number): Promise<boolean> {
    return this.ctx.run("preset", async () => {
      await this.ctx.client.set("netRemote.nav.action.selectPreset", key);
      this.ctx.update({ currentPreset: key });
      this.ctx.playbackChanged();
    });
  }

  /** Saves what's playing into slot `key`, replacing what was there. */
  store(key: number): Promise<boolean> {
    const before = this.find(key);
    return this.write("presetStore", key, async () => {
      await this.ctx.client.set("netRemote.play.addPreset", key);
      await this.reload((items) => {
        const after = items.find((p) => p.key === key);
        return !!after?.name && (after.name !== before?.name || after.uniqid !== before?.uniqid);
      });
    });
  }

  remove(key: number): Promise<boolean> {
    return this.write("presetDelete", key, async () => {
      try {
        await this.ctx.client.set("netRemote.nav.preset.delete", key);
      } catch (error) {
        if (isFsapiError(error, "status") && error.fsStatus === "FS_NODE_DOES_NOT_EXIST") {
          this.set({ deleteUnsupported: true });
        }
        throw error;
      }
      await this.reload((items) => !items.find((p) => p.key === key)?.name);
    });
  }

  /** Swaps a stored preset with its neighbour (-1: up, 1: down), like UNDOK's two LIST_SETs. */
  move(key: number, direction: -1 | 1): Promise<boolean> {
    const items = this.state.items;
    const index = items.findIndex((p) => p.key === key);
    const preset = items[index];
    const other = items[index + direction];
    if (!preset?.name || !other) return Promise.resolve(false);
    return this.write("presetMove", key, async () => {
      await this.writeSlot(other.key, preset);
      if (other.name) await this.writeSlot(preset.key, other);
      else await this.ctx.client.set("netRemote.nav.preset.delete", preset.key);
      await this.reload();
    });
  }

  private find(key: number): Preset | undefined {
    return this.state.items.find((p) => p.key === key);
  }

  private write(action: string, key: number, task: () => Promise<void>): Promise<boolean> {
    this.set({ busyKey: key });
    return this.ctx.run(action, task).finally(() => this.set({ busyKey: undefined }));
  }

  private writeSlot(key: number, preset: Preset): Promise<void> {
    return this.ctx.client.listSet("netRemote.nav.presets", key, {
      name: preset.name,
      type: preset.type || this.defaultType(),
      url: presetUrl(preset),
    });
  }

  /** What UNDOK writes when a preset has no type (`n5/n.java:137-143`). */
  private defaultType(): string {
    const { modes, modeKey } = this.ctx.snapshot();
    const id = modes.find((m) => m.key === modeKey)?.id;
    if (id === "IR") return "AirableRadio";
    if (id === "AIRABLE_PODCASTS") return "Podcasts";
    return "";
  }

  private async read(): Promise<Preset[]> {
    await ensureNavReady(this.ctx.client, this.ctx.nav);
    return this.ctx.client.listAllItems("netRemote.nav.presets", { pageSize: 30 });
  }

  /** Re-reads the list; radios can take a moment to show a change, so retry a few times. */
  private async reload(changed: (items: Preset[]) => boolean = () => true): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      const items = await this.read();
      if (changed(items) || attempt >= 3) {
        this.set({ status: "ready", items });
        return;
      }
      await sleep(this.ctx.nav.pollMs ?? 500);
    }
  }
}
