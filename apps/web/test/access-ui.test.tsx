// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App.tsx";
import { I18nProvider } from "../src/i18n/index.tsx";
import en from "../src/i18n/messages/en.json";
import type { LocalAccess } from "../src/radio/access.ts";
import { RegistryContext } from "../src/radio/hooks.ts";
import { RadioRegistry } from "../src/radio/registry.ts";

let access: LocalAccess = "open";
vi.mock("../src/radio/access.ts", () => ({ useLocalAccess: () => access }));

afterEach(cleanup);

function renderApp() {
  render(
    <I18nProvider locale="en" messages={en}>
      <RegistryContext.Provider value={new RadioRegistry()}>
        <App />
      </RegistryContext.Provider>
    </I18nProvider>,
  );
}

describe("local network access", () => {
  it("says up front when this browser can't reach radios from a secure page", () => {
    access = "blocked";
    renderApp();
    expect(screen.getByText("This browser can't reach your radios from this page")).toBeTruthy();
    expect(screen.getByText(/On an iPhone or iPad no browser allows it yet/)).toBeTruthy();
  });

  it("explains how to turn the permission back on", () => {
    access = "denied";
    renderApp();
    expect(screen.getByText("Local network access is turned off for this site")).toBeTruthy();
  });

  it("tells to allow the browser's question, and says nothing when there's no question", () => {
    access = "ask";
    renderApp();
    expect(screen.getByText(/Your browser will ask to let this site reach devices/)).toBeTruthy();
    cleanup();
    access = "open";
    renderApp();
    expect(screen.queryByText(/Your browser will ask/)).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
