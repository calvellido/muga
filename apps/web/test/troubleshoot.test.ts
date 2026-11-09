import { describe, expect, it } from "vitest";
import { reportText } from "../src/radio/troubleshoot.ts";
import { simulatedRadio } from "./support.ts";

const setup = simulatedRadio();
const fast = { controller: { standbyMs: 5 } };

describe("unstick speaker", () => {
  it("frees the session, then turns the radio off and on again in the same source", async () => {
    const { sim, controller } = await setup(fast);
    await controller.setMode(3);
    await controller.refreshNow();
    const before = sim.requests.length;

    await controller.troubleshoot.start();

    const steps = sim.requests
      .slice(before)
      .filter((r) => r.verb !== "GET" && r.verb !== "GET_MULTIPLE")
      .map((r) => `${r.verb} ${r.node ?? ""}`.trim());
    expect(steps).toEqual([
      "CREATE_SESSION",
      "DELETE_SESSION",
      "SET netRemote.sys.power",
      "SET netRemote.sys.power",
    ]);
    expect(sim.sessionId).toBeUndefined();
    expect(sim.get("netRemote.sys.power")).toBe(1);
    expect(sim.get("netRemote.sys.mode")).toBe(3);
    expect(controller.getSnapshot().troubleshoot.step).toBe("done");
  });

  it("keeps a status report of the radio's playback", async () => {
    const { controller } = await setup(fast);
    await controller.troubleshoot.start();
    const { report } = controller.getSnapshot().troubleshoot;
    const entries = new Map(report?.entries);
    expect(entries.get("netRemote.sys.power")).toBe("ON");
    expect(entries.get("netRemote.multiroom.group.state")).toBe("NO_GROUP");
    expect(entries.has("netRemote.spotify.status")).toBe(true);
  });

  it("asks first when the radio is in a multiroom group", async () => {
    const { sim, controller } = await setup(fast);
    sim.set("netRemote.multiroom.group.state", "CLIENT");
    sim.set("netRemote.multiroom.group.name", "Kitchen");

    await controller.troubleshoot.start();
    expect(controller.getSnapshot().troubleshoot).toMatchObject({
      step: "confirmGroup",
      groupName: "Kitchen",
    });
    expect(sim.requests.some((r) => r.verb === "CREATE_SESSION")).toBe(false);

    controller.troubleshoot.cancel();
    expect(controller.getSnapshot().troubleshoot.step).toBe("idle");

    await controller.troubleshoot.start();
    await controller.troubleshoot.confirm();
    expect(controller.getSnapshot().troubleshoot.step).toBe("done");
    expect(sim.get("netRemote.sys.power")).toBe(1);
  });

  it("formats the report for sharing", () => {
    const text = reportText({ at: Date.UTC(2026, 10, 9, 21, 43), entries: [["a", "1"]] }, [
      ["Muga", "2.2.0"],
    ]);
    expect(text).toBe("Muga: 2.2.0\nRead at: 2026-11-09T21:43:00.000Z\na: 1");
  });
});
