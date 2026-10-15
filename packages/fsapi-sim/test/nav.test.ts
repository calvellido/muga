import {
  enableNav,
  FsapiClient,
  isNavFailure,
  NAV_UP,
  NavItemType,
  navigate,
  readNavInfo,
  readNavPage,
  resetNav,
  searchNav,
  selectNavItem,
} from "@muga/fsapi-core";
import { afterEach, describe, expect, it } from "vitest";
import { type RadioSimulator, type SimulatorOptions, startSimulator } from "../src/index.ts";

let sim: RadioSimulator | undefined;

afterEach(async () => {
  await sim?.close();
  sim = undefined;
});

const FAST = { pollMs: 5, timeoutMs: 2_000 };

async function setup(options: SimulatorOptions = {}) {
  sim = await startSimulator(options);
  return { sim, client: new FsapiClient({ host: sim.host }) };
}

const names = (items: readonly { name: string }[]) => items.map((i) => i.name);

describe("menu navigation (nav.*) against the simulator", () => {
  it("turns navigation on and lists the source's top menu", async () => {
    const { sim, client } = await setup();
    await expect(client.get("netRemote.nav.status")).rejects.toMatchObject({
      fsStatus: "FS_NODE_BLOCKED",
    });
    await expect(enableNav(client, FAST)).resolves.toBe("READY_ROOT");
    expect(sim.get("netRemote.nav.state")).toBe(1);
    const page = await readNavPage(client);
    expect(names(page.items)).toEqual(["Search", "Local stations", "Genres", "Podcasts"]);
    expect(page.items[0]?.type).toBe(NavItemType.SearchDirectory);
    expect(page.items[1]?.type).toBe(NavItemType.Directory);
    expect(page.listEnd).toBe(true);
    await expect(readNavInfo(client)).resolves.toEqual({ numItems: 4, depth: 0 });
  });

  it("enters folders, pages through long lists and goes back up", async () => {
    const { client } = await setup();
    await resetNav(client, FAST);
    await navigate(client, 2, FAST); // Genres
    await navigate(client, 0, FAST); // Jazz
    await expect(readNavInfo(client)).resolves.toEqual({ numItems: 30, depth: 2 });

    const first = await readNavPage(client);
    expect(first.items).toHaveLength(14);
    expect(first.listEnd).toBe(false);
    const second = await readNavPage(client, first.items.at(-1)?.key);
    expect(second.items[0]?.name).toBe("Jazz Lounge 15");

    await navigate(client, NAV_UP, FAST);
    expect(names((await readNavPage(client)).items)).toEqual([
      "Jazz",
      "Classical",
      "News",
      "Experimental",
    ]);
  });

  it("waits while the radio reports WAITING", async () => {
    const { client } = await setup({ navDelayMs: 40 });
    await resetNav(client, FAST);
    await navigate(client, 1, FAST);
    expect(names((await readNavPage(client)).items)).toContain("Harbour Talk");
  });

  it("plays an item", async () => {
    const { sim, client } = await setup();
    await resetNav(client, FAST);
    await navigate(client, 1, FAST);
    await selectNavItem(client, 2, FAST);
    expect(sim.get("netRemote.play.info.name")).toBe("Harbour Talk");
  });

  it("searches through the SearchDirectory item", async () => {
    const { client } = await setup();
    await resetNav(client, FAST);
    await searchNav(client, 0, "classical", FAST);
    expect(names((await readNavPage(client)).items)).toEqual(["Bay Classical"]);
  });

  it("rejects navigation that the menu doesn't allow", async () => {
    const { client } = await setup();
    await expect(navigate(client, 0, FAST)).rejects.toMatchObject({ fsStatus: "FS_FAIL" });
    await resetNav(client, FAST);
    await expect(navigate(client, NAV_UP, FAST)).rejects.toMatchObject({ fsStatus: "FS_FAIL" });
    await navigate(client, 1, FAST);
    await expect(navigate(client, 0, FAST)).rejects.toMatchObject({ fsStatus: "FS_FAIL" });
  });

  it("loses the menu position on a source change", async () => {
    const { sim, client } = await setup();
    await resetNav(client, FAST);
    await client.set("netRemote.sys.mode", 3); // DAB
    expect(sim.get("netRemote.nav.state")).toBe(0);
    await expect(readNavPage(client)).rejects.toMatchObject({ fsStatus: "FS_NODE_BLOCKED" });
    await enableNav(client, FAST);
    expect((await readNavPage(client)).items[0]?.name).toBe("Atlantic Hits");
  });

  it("reports FATAL_ERR for a source without a menu, but still lists its presets", async () => {
    const { client } = await setup();
    await client.set("netRemote.sys.mode", 4); // FM: presets, no menu
    await expect(enableNav(client, FAST)).resolves.toBe("FATAL_ERR");
    const presets = await client.listAllItems("netRemote.nav.presets");
    expect(presets[0]?.name).toBe("Radio Muga");
    const error = await resetNav(client, FAST).catch((e: unknown) => e);
    expect(isNavFailure(error)).toBe(true);
  });
});
