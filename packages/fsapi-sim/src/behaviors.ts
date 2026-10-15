import { NAV_UP, NavItemSubType, NavItemType } from "@muga/fsapi-core";
import type { SimListItem, SimMenuItem, SimModeProfile } from "./profile.ts";

/** What a behavior may touch. Values are decoded (enum names allowed), like `RadioSimulator.set`. */
export interface SimState {
  get(path: string): number | string | undefined;
  set(path: string, value: number | string): void;
  list(path: string): SimListItem[];
  setList(path: string, items: SimListItem[]): void;
  /** Blocked nodes answer FS_NODE_BLOCKED to reads. */
  setBlocked(paths: readonly string[], blocked: boolean): void;
}

export interface BehaviorOptions {
  modes: Record<string, SimModeProfile>;
  /** How long `nav.status` stays WAITING after each navigation step. */
  navDelayMs: number;
  /** Runs `fn` later; the simulator cancels pending calls when it closes. */
  later(ms: number, fn: () => void): void;
}

export interface Behaviors {
  /** Side effects of a SET that was accepted. Returns a status to answer instead of FS_OK. */
  apply(path: string, value: number | string): string | undefined;
}

const NO_PRESET = 0xffff_ffff;
const NAV_CAP_NAVIGATION = 0x1;
/** Read while navigation is off, a real radio (ICD2018) answers FS_NODE_BLOCKED for these. */
const NAV_NODES = [
  "netRemote.nav.status",
  "netRemote.nav.list",
  "netRemote.nav.presets",
  "netRemote.nav.numItems",
  "netRemote.nav.depth",
];

function itemType(item: SimMenuItem): keyof typeof NavItemType {
  return item.type ?? (item.children ? "Directory" : "PlayableItem");
}

/** Playable items anywhere below `items` whose name or artist contains `term`. */
function search(items: readonly SimMenuItem[], term: string): SimMenuItem[] {
  return items.flatMap((item) => {
    if (item.children) return search(item.children, term);
    const text = `${item.name} ${item.artist ?? ""}`.toLowerCase();
    return itemType(item) === "PlayableItem" && text.includes(term) ? [item] : [];
  });
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

/**
 * Approximates what a real radio does after a SET, so apps built against the simulator see
 * plausible changes. Includes a menu model for `nav.*`, after an ICD2018 (V2.13.21c):
 * - one position per radio, reset by `nav.state`, moved by `nav.action.navigate`;
 * - while `nav.state` is OFF (also after a source change or standby), the nav nodes are blocked;
 * - a source without a menu (no `nav.caps` navigation bit, or an empty top level) reports
 *   FATAL_ERR, but its presets can still be read.
 */
export function createBehaviors(state: SimState, options: BehaviorOptions): Behaviors {
  /** The list shown at each depth; empty while navigation is off. */
  let stack: SimMenuItem[][] = [];
  let generation = 0;

  const currentMode = () => {
    const key = state.get("netRemote.sys.mode");
    const id = state.list("netRemote.sys.caps.validModes").find((m) => m.key === key)?.id;
    return options.modes[String(id)];
  };

  const settle = (status: string) => {
    const current = ++generation;
    if (options.navDelayMs <= 0) return state.set("netRemote.nav.status", status);
    state.set("netRemote.nav.status", "WAITING");
    options.later(options.navDelayMs, () => {
      if (current === generation) state.set("netRemote.nav.status", status);
    });
  };

  const publish = () => {
    const items = stack.at(-1) ?? [];
    state.setList(
      "netRemote.nav.list",
      items.map((item, key) => ({
        key,
        name: item.name,
        type: NavItemType[itemType(item)],
        subType: NavItemSubType[item.subType ?? "None"],
        graphicUri: item.graphicUri ?? "",
        artist: item.artist ?? "",
        contextMenu: 0,
      })),
    );
    state.set("netRemote.nav.numItems", items.length);
    state.set("netRemote.nav.depth", Math.max(0, stack.length - 1));
    settle(stack.length > 1 ? "READY" : "READY_ROOT");
  };

  const navOff = () => {
    generation++;
    stack = [];
    state.setList("netRemote.nav.list", []);
    state.set("netRemote.nav.numItems", 0);
    state.set("netRemote.nav.depth", 0);
    state.set("netRemote.nav.status", "FAIL");
    // A source change turns navigation off on a real radio, too.
    state.set("netRemote.nav.state", "OFF");
    state.setBlocked(NAV_NODES, true);
  };

  const navOn = () => {
    state.setBlocked(NAV_NODES, false);
    const caps = Number(state.get("netRemote.nav.caps") ?? 0);
    const menu = currentMode()?.menu ?? [];
    if ((caps & NAV_CAP_NAVIGATION) === 0 || menu.length === 0) {
      generation++;
      stack = [];
      state.setList("netRemote.nav.list", []);
      state.set("netRemote.nav.numItems", -1);
      state.set("netRemote.nav.status", "FATAL_ERR");
      return;
    }
    stack = [menu];
    publish();
  };

  const play = (name: string, text: string, graphicUri = "") => {
    state.set("netRemote.play.info.name", name);
    state.set("netRemote.play.info.text", text);
    state.set("netRemote.play.info.graphicUri", graphicUri);
    state.set("netRemote.play.status", "PLAYING");
  };

  const navigate = (key: number) => {
    if (stack.length === 0) return "FS_FAIL";
    if (key === NAV_UP) {
      if (stack.length <= 1) return "FS_FAIL";
      stack.pop();
      publish();
      return undefined;
    }
    const item = stack.at(-1)?.[key];
    if (!item) return "FS_FAIL";
    switch (itemType(item)) {
      case "Directory":
        stack.push(item.children ?? []);
        break;
      case "SearchDirectory": {
        const term = String(state.get("netRemote.nav.searchTerm") ?? "")
          .trim()
          .toLowerCase();
        stack.push(term ? search(currentMode()?.menu ?? [], term) : []);
        break;
      }
      default:
        return "FS_FAIL";
    }
    publish();
    return undefined;
  };

  const selectItem = (key: number) => {
    const item = stack.at(-1)?.[key];
    if (!item || itemType(item) !== "PlayableItem") return "FS_FAIL";
    play(item.name, item.artist || "Playing from the menu", item.graphicUri);
    state.set("netRemote.nav.preset.currentPreset", NO_PRESET);
    return undefined;
  };

  if (state.get("netRemote.nav.state") === 1) navOn();
  else navOff();

  return {
    apply(path, value) {
      switch (path) {
        case "netRemote.sys.power":
          state.set("netRemote.play.status", value === 1 ? "PLAYING" : "IDLE");
          if (value !== 1) navOff();
          return undefined;
        case "netRemote.sys.mode": {
          const mode = state.list("netRemote.sys.caps.validModes").find((m) => m.key === value);
          const label = String(mode?.label ?? `Mode ${value}`);
          for (const [node, v] of Object.entries(currentMode()?.values ?? {})) state.set(node, v);
          play(label, `Listening to ${label}`);
          state.set("netRemote.nav.preset.currentPreset", NO_PRESET);
          navOff();
          return undefined;
        }
        case "netRemote.play.control": {
          const status = { 0: "STOPPED", 1: "PLAYING", 2: "PAUSED" }[value as 0 | 1 | 2];
          if (status) state.set("netRemote.play.status", status);
          else {
            // NEXT / PREVIOUS: pretend the track changed.
            const text = String(state.get("netRemote.play.info.text"));
            const track = Number(text.match(/\d+$/)?.[0] ?? 1);
            const next = Math.max(1, track + (value === 3 ? 1 : -1));
            state.set("netRemote.play.info.text", `Simulated track ${next}`);
            state.set("netRemote.play.position", 0);
          }
          return undefined;
        }
        case "netRemote.nav.state":
          if (value === 1) navOn();
          else navOff();
          return undefined;
        case "netRemote.nav.action.navigate":
          return navigate(Number(value));
        case "netRemote.nav.action.selectItem":
          return selectItem(Number(value));
        case "netRemote.nav.action.selectPreset": {
          const preset = state.list("netRemote.nav.presets").find((p) => p.key === value);
          if (!preset?.name) return "FS_FAIL";
          play(String(preset.name), "Playing preset");
          state.set("netRemote.nav.preset.currentPreset", value);
          return undefined;
        }
        case "netRemote.play.addPreset": {
          const name = String(state.get("netRemote.play.info.name") ?? "");
          const items = state.list("netRemote.nav.presets");
          const slot = items.find((p) => p.key === value);
          if (!slot) return "FS_FAIL";
          Object.assign(slot, { name, type: "IR", url: `http://radio.example/${slug(name)}` });
          state.setList("netRemote.nav.presets", items);
          state.set("netRemote.play.addPresetStatus", "PRESET_STORRED");
          return undefined;
        }
        case "netRemote.nav.preset.delete": {
          const items = state.list("netRemote.nav.presets");
          if (!items.some((p) => p.key === value)) return "FS_FAIL";
          state.setList(
            "netRemote.nav.presets",
            items.map((p) =>
              p.key === value
                ? { ...p, name: "", type: "", uniqid: "", blob: "", artworkUrl: "", url: "" }
                : p,
            ),
          );
          return undefined;
        }
        default:
          return undefined;
      }
    },
  };
}
