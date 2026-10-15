import { describe, expect, it } from "vitest";
import type { RadioController } from "../src/radio/controller.ts";
import { presetAbilities } from "../src/radio/presets.ts";
import { simulatedRadio } from "./support.ts";

const setup = simulatedRadio();

const names = (controller: RadioController) =>
  controller.getSnapshot().presets.items.map((p) => p.name);

describe("PresetManager", () => {
  it("offers storing, deleting and reordering when the radio allows them", async () => {
    const { controller } = await setup();
    await controller.presets.load();
    expect(presetAbilities(controller.getSnapshot())).toEqual({
      store: true,
      remove: true,
      reorder: true,
    });
  });

  it("stores what's playing into a slot", async () => {
    const { sim, controller } = await setup();
    await controller.presets.load();
    expect(await controller.presets.store(3)).toBe(true);
    expect(
      sim.requests.some((r) => r.verb === "SET" && r.node === "netRemote.play.addPreset"),
    ).toBe(true);
    expect(names(controller)).toEqual(["Radio Muga", "Frontera FM", "", "Radio Muga"]);
    expect(controller.getSnapshot().presets.busyKey).toBeUndefined();
  });

  it("deletes a preset", async () => {
    const { controller } = await setup();
    await controller.presets.load();
    expect(await controller.presets.remove(0)).toBe(true);
    expect(names(controller)).toEqual(["", "Frontera FM", "", ""]);
  });

  it("swaps neighbours with LIST_SET, keeping each preset's stream URL", async () => {
    const { sim, controller } = await setup();
    await controller.presets.load();
    expect(await controller.presets.move(0, 1)).toBe(true);
    expect(names(controller)).toEqual(["Frontera FM", "Radio Muga", "", ""]);
    const urls = sim.list("netRemote.nav.presets").map((p) => p.url);
    expect(urls.slice(0, 2)).toEqual([
      "http://radio.example/frontera-fm",
      "http://radio.example/radio-muga",
    ]);
    expect(sim.requests.filter((r) => r.verb === "LIST_SET")).toHaveLength(2);
  });

  it("moves a preset into an empty slot by writing it there and clearing the old one", async () => {
    const { controller } = await setup();
    await controller.presets.load();
    expect(await controller.presets.move(1, 1)).toBe(true);
    expect(names(controller)).toEqual(["Radio Muga", "", "Frontera FM", ""]);
  });

  it("doesn't reorder presets that lack a stream URL", async () => {
    const { controller } = await setup({
      sim: {
        profile: {
          lists: {
            "netRemote.nav.presets": [
              { key: 0, name: "Radio Muga", type: "IR", uniqid: "", blob: "", artworkUrl: "" },
              { key: 1, name: "", type: "", uniqid: "", blob: "", artworkUrl: "" },
            ],
          },
        },
      },
    });
    await controller.presets.load();
    expect(presetAbilities(controller.getSnapshot())).toMatchObject({
      remove: true,
      reorder: false,
    });
  });

  it("only stores when the radio doesn't report preset editing", async () => {
    const { controller } = await setup({
      sim: { profile: { values: { "netRemote.nav.caps": 0x3 } } },
    });
    await controller.presets.load();
    expect(presetAbilities(controller.getSnapshot())).toEqual({
      store: true,
      remove: false,
      reorder: false,
    });
  });

  it("stops offering delete once the radio says the node doesn't exist", async () => {
    const { controller } = await setup({
      sim: { profile: { missingNodes: ["netRemote.nav.preset.delete"] } },
    });
    await controller.presets.load();
    expect(await controller.presets.remove(0)).toBe(false);
    expect(controller.getSnapshot().lastError).toMatchObject({ action: "presetDelete" });
    expect(presetAbilities(controller.getSnapshot()).remove).toBe(false);
  });
});
