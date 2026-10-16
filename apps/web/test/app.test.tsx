// @vitest-environment happy-dom
import { request } from "node:http";
import type { FetchLike } from "@muga/fsapi-core";
import {
  type RadioSimulator,
  type SimulatedHome,
  type SimulatorOptions,
  startSimulatedHome,
  startSimulator,
} from "@muga/fsapi-sim";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.tsx";
import { I18nProvider } from "../src/i18n/index.tsx";
import en from "../src/i18n/messages/en.json";
import { RegistryContext } from "../src/radio/hooks.ts";
import { RadioRegistry, type StorageLike } from "../src/radio/registry.ts";

let sim: RadioSimulator | undefined;
let home: SimulatedHome | undefined;
let registry: RadioRegistry | undefined;

/**
 * happy-dom's fetch preflights even simple GETs, which real browsers don't, so the UI
 * talks to the simulator through a plain node:http transport instead.
 */
const nodeFetch: FetchLike = (url, { signal }) =>
  new Promise((resolve, reject) => {
    const req = request(url, { signal }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        body += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text: async () => body }));
    });
    req.on("error", reject);
    req.end();
  });

afterEach(async () => {
  cleanup();
  registry?.stop();
  await sim?.close();
  await home?.close();
  sim = undefined;
  home = undefined;
});

function renderApp(options: { scanHosts?: string[]; storage?: StorageLike } = {}) {
  const hosts = options.scanHosts ?? [];
  registry = new RadioRegistry({
    fetch: nodeFetch,
    storage: options.storage,
    finder: { timeoutMs: 500, ranges: async () => [{ subnet: "test", hosts }] },
    controller: { activeIntervalMs: 100, navPollMs: 5, dabPollMs: 5 },
    multiroom: {
      intervalMs: 5_000,
      settleMs: 0,
      waits: { create: 0, add: 0, destroy: 0, streamable: 0 },
    },
  });
  render(
    <I18nProvider locale="en" messages={en}>
      <RegistryContext.Provider value={registry}>
        <App />
      </RegistryContext.Provider>
    </I18nProvider>,
  );
}

/** Starts a simulator, connects it as a speaker and waits for its view. */
async function addSimulatedSpeaker(options: SimulatorOptions = {}) {
  sim = await startSimulator(options);
  const user = userEvent.setup();
  renderApp();
  await user.type(screen.getByLabelText("IP address"), sim.host);
  await user.click(screen.getByRole("button", { name: "Connect" }));
  expect(await screen.findByRole("heading", { level: 2, name: "Radio Muga" })).toBeTruthy();
  return { sim, user };
}

describe("App", () => {
  it("connects a speaker, controls playback and recalls a preset", async () => {
    sim = await startSimulator();
    const user = userEvent.setup();
    renderApp();

    expect(screen.getByRole("heading", { name: "No speakers yet" })).toBeTruthy();
    await user.type(screen.getByLabelText("IP address"), sim.host);
    await user.click(screen.getByRole("button", { name: "Connect" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Muga Simulator" })).toBeTruthy();
    expect(await screen.findByRole("heading", { level: 2, name: "Radio Muga" })).toBeTruthy();

    await waitFor(() => expect(document.title).toBe("▶ Radio Muga — Muga Simulator"));

    await user.click(await screen.findByRole("button", { name: "Pause" }));
    await waitFor(() => expect(sim?.get("netRemote.play.status")).toBe(3));
    expect(await screen.findByRole("button", { name: "Play" })).toBeTruthy();
    await waitFor(() => expect(document.title).toBe("⏸ Radio Muga — Muga Simulator"));

    await user.click(screen.getByRole("tab", { name: "Presets" }));
    const panel = screen.getByRole("tabpanel");
    await user.click(await within(panel).findByRole("button", { name: /Frontera FM/ }));
    expect(await screen.findByRole("heading", { level: 2, name: "Frontera FM" })).toBeTruthy();
  });

  it("browses the source's menu and plays a station", async () => {
    const { user } = await addSimulatedSpeaker();
    await user.click(screen.getByRole("tab", { name: "Browse" }));
    const panel = screen.getByRole("tabpanel");

    await user.click(await within(panel).findByRole("button", { name: /Genres/ }));
    await user.click(await within(panel).findByRole("button", { name: /Classical/ }));
    const location = within(panel).getByRole("navigation", { name: "Menu location" });
    expect((await within(location).findByText("Classical")).getAttribute("aria-current")).toBe(
      "location",
    );

    await user.click(await within(panel).findByRole("button", { name: /Chamber Hours/ }));
    expect(await screen.findByRole("heading", { level: 2, name: "Chamber Hours" })).toBeTruthy();

    await user.click(within(panel).getByRole("button", { name: "Back" }));
    expect(await within(panel).findByRole("button", { name: /Experimental/ })).toBeTruthy();
    await user.click(within(location).getByRole("button", { name: "Internet radio" }));
    await user.type(await within(panel).findByRole("searchbox"), "delta");
    await user.click(within(panel).getByRole("button", { name: "Search" }));
    expect(await within(panel).findByRole("button", { name: /Delta News/ })).toBeTruthy();
  });

  it("stores and deletes presets in edit mode", async () => {
    const { sim, user } = await addSimulatedSpeaker();
    // happy-dom has no dialogs; accept every confirmation.
    const confirm = vi.fn(() => true);
    window.confirm = confirm;
    await user.click(screen.getByRole("tab", { name: "Presets" }));
    const panel = screen.getByRole("tabpanel");

    await user.click(await within(panel).findByRole("button", { name: "Edit" }));
    await user.click(within(panel).getByRole("button", { name: "Save Radio Muga as preset 3" }));
    await waitFor(() =>
      expect(sim.list("netRemote.nav.presets").find((p) => p.key === 2)?.name).toBe("Radio Muga"),
    );

    // Saving keeps every preset button disabled until the radio's list shows the new preset,
    // which on a slow machine is after the simulator already has it.
    const remove = await within(panel).findByRole("button", {
      name: "Delete preset 2, Frontera FM",
    });
    await waitFor(() => expect((remove as HTMLButtonElement).disabled).toBe(false));
    await user.click(remove);
    await waitFor(() =>
      expect(sim.list("netRemote.nav.presets").find((p) => p.key === 1)?.name).toBe(""),
    );
    expect(confirm).toHaveBeenCalledWith("Delete preset 2, Frontera FM?");

    await user.click(within(panel).getByRole("button", { name: "Done" }));
    expect(await within(panel).findAllByRole("button", { name: /Radio Muga/ })).toHaveLength(2);
  });

  it("tunes FM with the dial and seeks to the next station", async () => {
    const { sim, user } = await addSimulatedSpeaker();
    await user.click(screen.getByRole("button", { name: "FM" }));
    const dial = await screen.findByRole("slider", { name: "FM frequency" });
    expect(dial.getAttribute("aria-valuetext")).toBe("93.20 MHz");

    await user.click(screen.getByRole("button", { name: "Tune up one step" }));
    await waitFor(() => expect(sim.get("netRemote.play.frequency")).toBe(93_250));
    await user.click(screen.getByRole("button", { name: "Seek up" }));
    await waitFor(() => expect(sim.get("netRemote.play.frequency")).toBe(99_100));
    expect(await screen.findByRole("heading", { level: 2, name: "Harbour" })).toBeTruthy();
  });

  it("scans for DAB stations from the Browse tab", async () => {
    const { user } = await addSimulatedSpeaker({ dabScanStepMs: 5 });
    const confirm = vi.fn(() => true);
    window.confirm = confirm;
    await user.click(screen.getByRole("button", { name: "DAB" }));
    await user.click(screen.getByRole("tab", { name: "Browse" }));
    const panel = screen.getByRole("tabpanel");

    await user.click(await within(panel).findByRole("button", { name: "Scan for stations" }));
    expect(confirm).toHaveBeenCalled();
    expect(await within(panel).findByText("Scan finished: 12 stations found.")).toBeTruthy();
    expect(await within(panel).findByRole("button", { name: /Atlantic Hits/ })).toBeTruthy();
  });

  it("opens settings, renames the speaker and sets the sleep timer and EQ", async () => {
    const { sim, user } = await addSimulatedSpeaker();
    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Settings" })).toBeTruthy();
    expect(await screen.findByText("Wi-Fi: MugaNet")).toBeTruthy();

    const name = screen.getByLabelText("Speaker name");
    await user.clear(name);
    await user.type(name, "Kitchen");
    await user.click(screen.getByRole("button", { name: "Rename" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Kitchen" })).toBeTruthy();
    expect(sim.get("netRemote.sys.info.friendlyName")).toBe("Kitchen");

    await user.click(screen.getByRole("button", { name: "30 min" }));
    expect(await screen.findByText("Standby in 30 minutes.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Jazz" }));
    await waitFor(() => expect(sim.get("netRemote.sys.audio.eqPreset")).toBe(3));

    await user.click(screen.getByRole("button", { name: "Back to the player" }));
    expect(await screen.findByRole("tab", { name: "Sources" })).toBeTruthy();
  });

  it("groups speakers, sets a speaker's volume in the group and ungroups", async () => {
    home = await startSimulatedHome({ speakers: 3 });
    const [living, kitchen] = home.speakers;
    if (!living || !kitchen) throw new Error("speakers expected");
    const confirm = vi.fn(() => true);
    window.confirm = confirm;
    const user = userEvent.setup();
    renderApp();

    // Connect one speaker; the others show up as found on the network.
    await user.type(screen.getByLabelText("IP address"), living.host);
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Living room" })).toBeTruthy();
    await user.click(await screen.findByRole("button", { name: "Connect Kitchen" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Kitchen" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Connect Bedroom" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: /^Living room/ }));
    await user.click(
      await screen.findByRole("button", { name: "Group Living room with other speakers" }),
    );
    expect(await screen.findByRole("heading", { level: 2, name: "Group speakers" })).toBeTruthy();
    expect((screen.getByLabelText("Group name") as HTMLInputElement).value).toBe("Group 1");
    await user.click(screen.getByRole("checkbox", { name: /Kitchen/ }));
    await user.click(screen.getByRole("button", { name: "Create group" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Group 1" })).toBeTruthy();
    expect(kitchen.get("netRemote.multiroom.group.state")).toBe(1);
    expect(
      within(screen.getByRole("list", { name: "Speakers in Group 1" })).getAllByRole("listitem"),
    ).toHaveLength(2);
    expect(screen.getAllByText("Not shared with the group").length).toBeGreaterThan(0);

    fireEvent.change(await screen.findByLabelText("Volume of Kitchen"), {
      target: { value: "3" },
    });
    await waitFor(() => expect(kitchen.get("netRemote.sys.audio.volume")).toBe(3));

    // Kitchen's own page: the radio has no station name as a client; the group's is shown.
    await user.click(
      within(screen.getByRole("list", { name: "Speakers in Group 1" })).getByRole("button", {
        name: /Kitchen/,
      }),
    );
    expect(await screen.findByRole("heading", { level: 1, name: "Kitchen" })).toBeTruthy();
    expect(kitchen.get("netRemote.play.info.name")).toBe("");
    expect(await screen.findByRole("heading", { level: 2, name: "Radio Muga" })).toBeTruthy();
    expect(screen.getByText("Kitchen is playing with Group 1.")).toBeTruthy();

    // Choosing a source on a client makes it lead the group, as real radios do.
    const takeOver = screen.getByRole("region", { name: "Play something else" });
    await user.click(within(takeOver).getByRole("button", { name: /^Spotify/ }));
    expect(confirm).toHaveBeenCalledWith(
      "Kitchen will lead Group 1, and every speaker in it will play Spotify. Continue?",
    );
    expect(
      await screen.findByText("Kitchen leads Group 1: the group plays what it plays."),
    ).toBeTruthy();
    expect(kitchen.get("netRemote.multiroom.group.state")).toBe(2);
    expect(living.get("netRemote.multiroom.group.state")).toBe(1);

    await user.click(screen.getByRole("button", { name: "Open group" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Group 1" })).toBeTruthy();
    expect(await screen.findByText("Played from Kitchen")).toBeTruthy();

    // Standby is for the whole group.
    await user.click(screen.getByRole("button", { name: "Standby" }));
    await waitFor(() => expect(living.get("netRemote.sys.power")).toBe(0));
    expect(kitchen.get("netRemote.sys.power")).toBe(0);
    await user.click(await screen.findByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(living.get("netRemote.sys.power")).toBe(1));

    await user.click(screen.getByRole("button", { name: "Ungroup" }));
    expect(confirm).toHaveBeenCalledWith(
      "Ungroup Group 1? Each speaker goes back to playing on its own.",
    );
    // Back to the speaker that led the group by then.
    expect(await screen.findByRole("heading", { level: 1, name: "Kitchen" })).toBeTruthy();
    expect(kitchen.get("netRemote.multiroom.group.state")).toBe(0);
    expect(living.get("netRemote.multiroom.group.state")).toBe(0);
  });

  it("finds the speakers on the network and connects one", async () => {
    home = await startSimulatedHome({ speakers: 2 });
    const [living, kitchen] = home.speakers;
    const user = userEvent.setup();
    renderApp({ scanHosts: ["127.0.0.1:1", living?.host ?? "", kitchen?.host ?? ""] });

    await user.click(screen.getByRole("button", { name: "Find speakers" }));
    expect(await screen.findByText("Found 2 new speakers.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Connect Kitchen" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Kitchen" })).toBeTruthy();
    // Living room is still offered, and Kitchen no longer is.
    expect(screen.getByRole("button", { name: "Connect Living room" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Connect Kitchen" })).toBeNull();
  });

  it("looks for a speaker that no longer answers at its address", async () => {
    home = await startSimulatedHome({ speakers: 1 });
    const [living] = home.speakers;
    // Saved on an earlier visit, at an address it no longer has.
    const data = new Map([
      [
        "muga.radios.v1",
        JSON.stringify([
          { id: "002261000001", host: "127.0.0.1:1", pin: "1234", name: "Living room" },
        ]),
      ],
    ]);
    const user = userEvent.setup();
    renderApp({
      scanHosts: [living?.host ?? ""],
      storage: { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) },
    });
    expect(await screen.findByText("Living room isn't reachable")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Look for it" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Radio Muga" })).toBeTruthy();
    expect(registry?.getSnapshot().radios[0]?.host).toBe(living?.host);
  });

  it("explains why a speaker couldn't be connected", async () => {
    sim = await startSimulator({ pin: "4321" });
    const user = userEvent.setup();
    renderApp();
    await user.type(screen.getByLabelText("IP address"), sim.host);
    await user.click(screen.getByRole("button", { name: "Connect" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The radio rejected this PIN.");
  });
});
