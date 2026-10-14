import type { SimListItem } from "./profile.ts";

/** What a behavior may touch. Values are decoded (enum names allowed), like `RadioSimulator.set`. */
export interface SimState {
  get(path: string): number | string | undefined;
  set(path: string, value: number | string): void;
  list(path: string): SimListItem[];
  setList(path: string, items: SimListItem[]): void;
}

const NO_PRESET = 0xffff_ffff;

/**
 * Side effects of a successful SET, approximating what a real radio does so that
 * apps built against the simulator see plausible changes. `value` is the stored wire value.
 */
export function applyBehavior(state: SimState, path: string, value: number | string): void {
  switch (path) {
    case "netRemote.sys.power":
      state.set("netRemote.play.status", value === 1 ? "PLAYING" : "IDLE");
      return;
    case "netRemote.sys.mode": {
      const mode = state.list("netRemote.sys.caps.validModes").find((m) => m.key === value);
      const label = String(mode?.label ?? `Mode ${value}`);
      state.set("netRemote.play.info.name", label);
      state.set("netRemote.play.info.text", `Listening to ${label}`);
      state.set("netRemote.play.status", "PLAYING");
      state.set("netRemote.nav.preset.currentPreset", NO_PRESET);
      return;
    }
    case "netRemote.play.control": {
      const status = { 0: "STOPPED", 1: "PLAYING", 2: "PAUSED" }[value as 0 | 1 | 2];
      if (status) state.set("netRemote.play.status", status);
      else {
        // NEXT / PREVIOUS: pretend the track changed.
        const track = Number(String(state.get("netRemote.play.info.text")).match(/\d+$/)?.[0] ?? 1);
        const next = Math.max(1, track + (value === 3 ? 1 : -1));
        state.set("netRemote.play.info.text", `Simulated track ${next}`);
        state.set("netRemote.play.position", 0);
      }
      return;
    }
    case "netRemote.nav.state":
      state.set("netRemote.nav.status", "READY");
      return;
    case "netRemote.nav.action.selectPreset": {
      const preset = state.list("netRemote.nav.presets").find((p) => p.key === value);
      if (!preset?.name) return;
      state.set("netRemote.play.info.name", String(preset.name));
      state.set("netRemote.play.info.text", "Playing preset");
      state.set("netRemote.play.status", "PLAYING");
      state.set("netRemote.nav.preset.currentPreset", value);
      return;
    }
    case "netRemote.play.addPreset": {
      const name = String(state.get("netRemote.play.info.name") ?? "");
      const items = state.list("netRemote.nav.presets");
      const slot = items.find((p) => p.key === value) ?? { key: Number(value) };
      Object.assign(slot, { name, type: "IR" });
      state.setList("netRemote.nav.presets", items.includes(slot) ? items : [...items, slot]);
      state.set("netRemote.play.addPresetStatus", "PRESET_STORRED");
      return;
    }
    case "netRemote.nav.preset.delete": {
      const items = state
        .list("netRemote.nav.presets")
        .map((p) =>
          p.key === value ? { ...p, name: "", type: "", uniqid: "", blob: "", artworkUrl: "" } : p,
        );
      state.setList("netRemote.nav.presets", items);
      return;
    }
  }
}
