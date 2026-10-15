import {
  isFsapiError,
  isNavFailure,
  NAV_PAGE_SIZE,
  NAV_UP,
  NavItemType,
  type NavListItem,
  navigate,
  readNavInfo,
  readNavPage,
  resetNav,
  searchNav,
  selectNavItem,
} from "@muga/fsapi-core";
import { hasCap, NavCap, NO_PRESET } from "./caps.ts";
import type {
  BrowseCrumb,
  BrowseItem,
  BrowseItemKind,
  BrowseState,
  RadioContext,
} from "./types.ts";

export function initialBrowse(): BrowseState {
  return {
    status: "idle",
    modeKey: undefined,
    path: [],
    items: [],
    searchKey: undefined,
    total: undefined,
    nextKey: undefined,
    loadingMore: false,
    busy: false,
    pendingKey: undefined,
  };
}

const KINDS: Record<number, BrowseItemKind> = {
  [NavItemType.Directory]: "folder",
  [NavItemType.PlayableItem]: "playable",
  [NavItemType.MessageItem]: "message",
  [NavItemType.FetchErrItem]: "error",
};

function toItem(item: NavListItem): BrowseItem {
  const kind = KINDS[item.type] ?? "unsupported";
  return {
    key: item.key,
    name: (item.name ?? "").trim(),
    kind,
    artist: (item.artist ?? "").trim(),
    // OAuth items carry their login URL in graphicUri (doc 05 §3.10); only use it as artwork elsewhere.
    artworkUrl: kind === "unsupported" ? "" : (item.graphicUri ?? "").trim(),
  };
}

/** FS_* refusals and navigation failures can mean someone else moved the menu: worth a resync. */
function recoverable(error: unknown): boolean {
  return isNavFailure(error) || isFsapiError(error, "status");
}

class Superseded extends Error {}

/**
 * Menu browsing for the current source (doc 05 §3). The radio holds the position; this class
 * mirrors it as a path of folders and searches so it can rebuild the position after a reset
 * (`nav.state` OFF → ON, then replay), as UNDOK does. Steps run one at a time.
 */
export class BrowseSession {
  private queue: Promise<unknown> = Promise.resolve();
  private generation = 0;
  /** An open() in progress for the current generation; repeated calls share it. */
  private opening: { generation: number; done: Promise<void> } | undefined;

  constructor(private readonly ctx: RadioContext) {}

  private get state(): BrowseState {
    return this.ctx.snapshot().browse;
  }

  /** Forgets the menu (source change, standby); a running step won't write its result. */
  invalidate(): void {
    this.generation++;
    if (this.state.status !== "idle") this.ctx.update({ browse: initialBrowse() });
  }

  /** Shows the current source's menu: the same place again for the same source, else the top. */
  open(): Promise<void> {
    if (this.opening?.generation === this.generation) return this.opening.done;
    const done = this.exclusive(async (write) => {
      const snapshot = this.ctx.snapshot();
      const { navCaps, modeKey } = snapshot;
      if (navCaps !== undefined && !hasCap(navCaps, NavCap.Navigation)) {
        write({ ...initialBrowse(), status: "unsupported", modeKey });
        return;
      }
      const path = this.state.modeKey === modeKey ? this.state.path : [];
      write({
        ...(path.length ? {} : initialBrowse()),
        status: "loading",
        modeKey,
        path,
        busy: true,
      });
      try {
        await this.replay(path);
        await this.showLevel(path, write);
      } catch (error) {
        if (error instanceof Superseded) throw error;
        const unsupported = isNavFailure(error) && navCaps === undefined && path.length === 0;
        write({
          status: unsupported ? "unsupported" : "error",
          busy: false,
          pendingKey: undefined,
        });
        if (!unsupported && !isNavFailure(error)) this.ctx.fail("browse", error);
      }
    }).finally(() => {
      if (this.opening?.done === done) this.opening = undefined;
    });
    this.opening = { generation: this.generation, done };
    return done;
  }

  enter(item: BrowseItem): Promise<void> {
    if (item.kind !== "folder") return Promise.resolve();
    return this.step("browse", item.key, async (write) => {
      await this.recovering(() => navigate(this.ctx.client, item.key, this.ctx.nav));
      await this.showLevel(
        [...this.state.path, { kind: "folder", key: item.key, name: item.name }],
        write,
      );
    });
  }

  search(term: string): Promise<void> {
    const key = this.state.searchKey;
    const text = term.trim();
    if (key === undefined || !text) return Promise.resolve();
    return this.step("search", key, async (write) => {
      await this.recovering(() => searchNav(this.ctx.client, key, text, this.ctx.nav));
      await this.showLevel([...this.state.path, { kind: "search", key, term: text }], write);
    });
  }

  play(item: BrowseItem): Promise<void> {
    if (item.kind !== "playable") return Promise.resolve();
    return this.step("play", item.key, async (write) => {
      await this.recovering(() => selectNavItem(this.ctx.client, item.key, this.ctx.nav));
      write({ busy: false, pendingKey: undefined });
      this.ctx.update({ currentPreset: NO_PRESET });
      this.ctx.playbackChanged();
    });
  }

  /** Up one level. Leaving search results rebuilds the level, as UNDOK does. */
  back(): Promise<void> {
    const path = this.state.path;
    const last = path.at(-1);
    if (!last) return Promise.resolve();
    if (last.kind === "search") return this.goTo(path.length - 1);
    return this.step("browse", undefined, async (write) => {
      const parent = path.slice(0, -1);
      try {
        await navigate(this.ctx.client, NAV_UP, this.ctx.nav);
      } catch (error) {
        if (!recoverable(error)) throw error;
        await this.replay(parent);
      }
      await this.showLevel(parent, write);
    });
  }

  /** Jumps to a level of the path (0 = top menu). */
  goTo(depth: number): Promise<void> {
    const target = this.state.path.slice(0, Math.max(0, depth));
    return this.step("browse", undefined, async (write) => {
      await this.replay(target);
      await this.showLevel(target, write);
    });
  }

  loadMore(): Promise<void> {
    const { nextKey, loadingMore } = this.state;
    if (nextKey === undefined || loadingMore) return Promise.resolve();
    return this.exclusive(async (write) => {
      const start = this.state.nextKey;
      if (start === undefined) return;
      write({ loadingMore: true });
      try {
        const page = await this.recovering(() => readNavPage(this.ctx.client, start, this.ctx.nav));
        const { items, searchKey } = this.split(page.items);
        const known = new Set(this.state.items.map((i) => i.key));
        const merged = [...this.state.items, ...items.filter((i) => !known.has(i.key))];
        write({
          items: merged,
          searchKey: this.state.searchKey ?? searchKey,
          nextKey: this.next(page.items, page.listEnd, this.state.total, merged.length),
          loadingMore: false,
        });
      } catch (error) {
        if (error instanceof Superseded) throw error;
        write({ loadingMore: false });
        this.ctx.fail("browse", error);
      }
    });
  }

  // Steps

  /**
   * A user step on the level shown when it was requested; skipped if the level changed while it
   * waited its turn. Marks the item as pending and reports failures as lastError.
   */
  private step(
    action: string,
    pendingKey: number | undefined,
    task: (write: (patch: Partial<BrowseState>) => void) => Promise<void>,
  ): Promise<void> {
    const path = this.state.path;
    return this.exclusive(async (write) => {
      if (this.state.path !== path) return;
      write({ busy: true, pendingKey });
      try {
        await task(write);
      } catch (error) {
        if (error instanceof Superseded) throw error;
        write({ busy: false, pendingKey: undefined });
        this.ctx.fail(action, error);
      }
    });
  }

  /** Runs after the previous step; results are dropped once the menu was invalidated. */
  private exclusive(
    task: (write: (patch: Partial<BrowseState>) => void) => Promise<void>,
  ): Promise<void> {
    const generation = this.generation;
    const write = (patch: Partial<BrowseState>) => {
      if (generation !== this.generation) throw new Superseded();
      this.ctx.update({ browse: { ...this.state, ...patch } });
    };
    const run = this.queue.then(async () => {
      if (generation !== this.generation) return;
      try {
        await task(write);
      } catch (error) {
        if (!(error instanceof Superseded)) throw error;
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** On a refusal, rebuild the position (someone may have used the radio's menu) and retry once. */
  private async recovering<T>(task: () => Promise<T>): Promise<T> {
    try {
      return await task();
    } catch (error) {
      if (!recoverable(error)) throw error;
      await this.replay(this.state.path);
      return task();
    }
  }

  /** Top menu, then each folder and search of `path` again. */
  private async replay(path: readonly BrowseCrumb[]): Promise<void> {
    const { client, nav } = this.ctx;
    await resetNav(client, nav);
    for (const crumb of path) {
      if (crumb.kind === "folder") await navigate(client, crumb.key, nav);
      else await searchNav(client, crumb.key, crumb.term, nav);
    }
  }

  /** Reads the level the radio is on and shows it as `path`. */
  private async showLevel(
    path: BrowseCrumb[],
    write: (patch: Partial<BrowseState>) => void,
  ): Promise<void> {
    const { client, nav } = this.ctx;
    const info = await readNavInfo(client, nav).catch((error: unknown) => {
      if (isFsapiError(error, "status")) return { numItems: undefined, depth: undefined };
      throw error;
    });
    const page = await readNavPage(client, -1, nav);
    const { items, searchKey } = this.split(page.items);
    const total =
      info.numItems === undefined ? undefined : info.numItems - (searchKey === undefined ? 0 : 1);
    write({
      status: "ready",
      path,
      items,
      searchKey,
      total,
      nextKey: this.next(page.items, page.listEnd, total, items.length),
      loadingMore: false,
      busy: false,
      pendingKey: undefined,
    });
  }

  /** UNDOK pulls the SearchDirectory entry out of the list and offers it as a search box. */
  private split(raw: NavListItem[]): { items: BrowseItem[]; searchKey: number | undefined } {
    const search = raw.find((i) => i.type === NavItemType.SearchDirectory);
    return {
      items: raw.filter((i) => i !== search).map(toItem),
      searchKey: search?.key,
    };
  }

  private next(
    raw: NavListItem[],
    listEnd: boolean,
    total: number | undefined,
    shown: number,
  ): number | undefined {
    const last = raw.at(-1);
    if (listEnd || !last || raw.length < NAV_PAGE_SIZE) return undefined;
    if (total !== undefined && shown >= total) return undefined;
    return last.key;
  }
}
