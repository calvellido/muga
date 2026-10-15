import { FsapiClient } from "@muga/fsapi-core";
import { describe, expect, it } from "vitest";
import { NO_PRESET } from "../src/radio/caps.ts";
import type { RadioController } from "../src/radio/controller.ts";
import { simulatedRadio } from "./support.ts";

const setup = simulatedRadio();

const names = (controller: RadioController) =>
  controller.getSnapshot().browse.items.map((i) => i.name);

function item(controller: RadioController, name: string) {
  const found = controller.getSnapshot().browse.items.find((i) => i.name === name);
  if (!found) throw new Error(`No menu item ${name}`);
  return found;
}

describe("BrowseSession", () => {
  it("opens the top menu and offers the search entry as a search box", async () => {
    const { controller } = await setup();
    await controller.browse.open();
    const { browse } = controller.getSnapshot();
    expect(browse).toMatchObject({ status: "ready", path: [], searchKey: 0, total: 3 });
    expect(names(controller)).toEqual(["Local stations", "Genres", "Podcasts"]);
    expect(browse.items.map((i) => i.kind)).toEqual(["folder", "folder", "folder"]);
  });

  it("enters folders, loads more pages and goes back", async () => {
    const { controller } = await setup();
    await controller.browse.open();
    await controller.browse.enter(item(controller, "Genres"));
    await controller.browse.enter(item(controller, "Jazz"));
    let browse = controller.getSnapshot().browse;
    expect(browse.path.map((c) => c.kind === "folder" && c.name)).toEqual(["Genres", "Jazz"]);
    expect(browse.items).toHaveLength(14);
    expect(browse.total).toBe(30);

    await controller.browse.loadMore();
    await controller.browse.loadMore();
    browse = controller.getSnapshot().browse;
    expect(browse.items).toHaveLength(30);
    expect(browse.items.at(-1)?.name).toBe("Jazz Lounge 30");
    expect(browse.nextKey).toBeUndefined();

    await controller.browse.back();
    expect(names(controller)).toEqual(["Jazz", "Classical", "News", "Experimental"]);
    await controller.browse.goTo(0);
    expect(controller.getSnapshot().browse.path).toEqual([]);
    expect(names(controller)).toContain("Podcasts");
  });

  it("plays an item", async () => {
    const { sim, controller } = await setup();
    await controller.browse.open();
    await controller.browse.enter(item(controller, "Local stations"));
    await controller.browse.play(item(controller, "Harbour Talk"));
    expect(sim.get("netRemote.play.info.name")).toBe("Harbour Talk");
    expect(controller.getSnapshot().currentPreset).toBe(NO_PRESET);
    await controller.refreshNow();
    expect(controller.getSnapshot().play.name).toBe("Harbour Talk");
  });

  it("searches, and leaving the results rebuilds the level", async () => {
    const { controller } = await setup();
    await controller.browse.open();
    await controller.browse.search("lounge 2");
    let browse = controller.getSnapshot().browse;
    expect(browse.path).toEqual([{ kind: "search", key: 0, term: "lounge 2" }]);
    expect(names(controller)).toContain("Jazz Lounge 20");

    await controller.browse.back();
    browse = controller.getSnapshot().browse;
    expect(browse.path).toEqual([]);
    expect(browse.searchKey).toBe(0);
  });

  it("rebuilds its place when the radio's menu was turned off elsewhere", async () => {
    const { sim, controller } = await setup();
    await controller.browse.open();
    await controller.browse.enter(item(controller, "Genres"));
    await new FsapiClient({ host: sim.host }).set("netRemote.nav.state", "OFF");

    await controller.browse.enter(item(controller, "Classical"));
    expect(controller.getSnapshot().lastError).toBeUndefined();
    expect(names(controller)).toEqual(["Bay Classical", "Chamber Hours"]);
  });

  it("starts again from the top after a source change", async () => {
    const { controller } = await setup();
    await controller.browse.open();
    await controller.browse.enter(item(controller, "Genres"));
    await controller.setMode(3); // DAB
    expect(controller.getSnapshot().browse.status).toBe("idle");
    await controller.refreshNow();
    await controller.browse.open();
    expect(controller.getSnapshot().browse.path).toEqual([]);
    expect(names(controller)[0]).toBe("Atlantic Hits");
  });

  it("reports sources without a menu", async () => {
    const { controller } = await setup();
    await controller.setMode(1); // Spotify: nav.caps 0
    await controller.refreshNow();
    expect(controller.getSnapshot().navCaps).toBe(0);
    await controller.browse.open();
    expect(controller.getSnapshot().browse.status).toBe("unsupported");
  });

  it("shows only the latest source's menu when the source changes mid-step", async () => {
    const { controller } = await setup({ sim: { navDelayMs: 30 } });
    const opening = controller.browse.open();
    await new Promise<void>((resolve) => {
      const stop = controller.subscribe(() => {
        if (controller.getSnapshot().browse.status === "loading") {
          stop();
          resolve();
        }
      });
    });
    controller.browse.invalidate();
    await opening;
    expect(controller.getSnapshot().browse.status).toBe("idle");
  });
});
