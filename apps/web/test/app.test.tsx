// @vitest-environment happy-dom
import { request } from "node:http";
import type { FetchLike } from "@muga/fsapi-core";
import { type RadioSimulator, startSimulator } from "@muga/fsapi-sim";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
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
    controller: { activeIntervalMs: 100, navPollMs: 5 },
  });
  render(
    <I18nProvider locale="en" messages={en}>
      <RegistryContext.Provider value={registry}>
        <App />
      </RegistryContext.Provider>
    </I18nProvider>,
  );
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

  it("explains why a speaker couldn't be added", async () => {
    sim = await startSimulator({ pin: "4321" });
    const user = userEvent.setup();
    renderApp();
    await user.type(screen.getByLabelText("IP address"), sim.host);
    await user.click(screen.getByRole("button", { name: "Add speaker" }));
    expect((await screen.findByRole("alert")).textContent).toBe("The radio rejected this PIN.");
  });
});
