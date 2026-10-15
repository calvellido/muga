// @vitest-environment happy-dom
import { request } from "node:http";
import type { FetchLike } from "@muga/fsapi-core";
import { type RadioSimulator, type SimulatorOptions, startSimulator } from "@muga/fsapi-sim";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.tsx";
import { I18nProvider } from "../src/i18n/index.tsx";
import en from "../src/i18n/messages/en.json";
import { RegistryContext } from "../src/radio/hooks.ts";
import { RadioRegistry } from "../src/radio/registry.ts";

let sim: RadioSimulator | undefined;
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
});

function renderApp() {
  registry = new RadioRegistry({
    fetch: nodeFetch,
    controller: { activeIntervalMs: 100, navPollMs: 5, dabPollMs: 5 },
  });
  render(
    <I18nProvider locale="en" messages={en}>
      <RegistryContext.Provider value={registry}>
        <App />
      </RegistryContext.Provider>
    </I18nProvider>,
  );
}

/** Starts a simulator, adds it as a speaker and waits for its view. */
async function addSimulatedSpeaker(options: SimulatorOptions = {}) {
  sim = await startSimulator(options);
  const user = userEvent.setup();
  renderApp();
  await user.type(screen.getByLabelText("IP address"), sim.host);
  await user.click(screen.getByRole("button", { name: "Add speaker" }));
  expect(await screen.findByRole("heading", { level: 2, name: "Radio Muga" })).toBeTruthy();
  return { sim, user };
}

describe("App", () => {
  it("adds a speaker, controls playback and recalls a preset", async () => {
    sim = await startSimulator();
    const user = userEvent.setup();
    renderApp();

    expect(screen.getByRole("heading", { name: "No speakers yet" })).toBeTruthy();
    await user.type(screen.getByLabelText("IP address"), sim.host);
    await user.click(screen.getByRole("button", { name: "Add speaker" }));

    expect(await screen.findByRole("heading", { level: 1, name: "Muga Simulator" })).toBeTruthy();
    expect(await screen.findByRole("heading", { level: 2, name: "Radio Muga" })).toBeTruthy();

    await user.click(await screen.findByRole("button", { name: "Pause" }));
    await waitFor(() => expect(sim?.get("netRemote.play.status")).toBe(3));
    expect(await screen.findByRole("button", { name: "Play" })).toBeTruthy();

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

    await user.click(
      await within(panel).findByRole("button", { name: "Delete preset 2, Frontera FM" }),
    );
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

  it("explains why a speaker couldn't be added", async () => {
    sim = await startSimulator({ pin: "4321" });
    const user = userEvent.setup();
    renderApp();
    await user.type(screen.getByLabelText("IP address"), sim.host);
    await user.click(screen.getByRole("button", { name: "Add speaker" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The radio rejected this PIN.");
  });
});
