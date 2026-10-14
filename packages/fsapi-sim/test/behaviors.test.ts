import { FsapiClient } from "@muga/fsapi-core";
import { afterEach, describe, expect, it } from "vitest";
import { type RadioSimulator, startSimulator } from "../src/index.ts";

let sim: RadioSimulator | undefined;

afterEach(async () => {
  await sim?.close();
  sim = undefined;
});

describe("simulator behaviors", () => {
  it("plays a preset when it is selected", async () => {
    sim = await startSimulator();
    const client = new FsapiClient({ host: sim.host });
    await client.set("netRemote.nav.action.selectPreset", 1);
    await expect(client.get("netRemote.play.info.name")).resolves.toBe("Frontera FM");
    await expect(client.get("netRemote.nav.preset.currentPreset")).resolves.toBe(1);
  });

  it("reflects source changes and play control", async () => {
    sim = await startSimulator();
    const client = new FsapiClient({ host: sim.host });
    await client.set("netRemote.sys.mode", 3);
    await expect(client.get("netRemote.play.info.name")).resolves.toBe("DAB");
    await client.set("netRemote.play.control", "PAUSE");
    await expect(client.get("netRemote.play.status")).resolves.toBe("PAUSED");
    await client.set("netRemote.sys.power", "OFF");
    await expect(client.get("netRemote.play.status")).resolves.toBe("IDLE");
  });

  it("stores and deletes presets", async () => {
    sim = await startSimulator();
    const client = new FsapiClient({ host: sim.host });
    await client.set("netRemote.play.addPreset", 2);
    expect(sim.list("netRemote.nav.presets").find((p) => p.key === 2)?.name).toBe("Radio Muga");
    await client.set("netRemote.nav.preset.delete", 0);
    expect(sim.list("netRemote.nav.presets").find((p) => p.key === 0)?.name).toBe("");
  });

  it("can be turned off", async () => {
    sim = await startSimulator({ behaviors: false });
    const client = new FsapiClient({ host: sim.host });
    await client.set("netRemote.play.control", "PAUSE");
    await expect(client.get("netRemote.play.status")).resolves.toBe("PLAYING");
  });
});
