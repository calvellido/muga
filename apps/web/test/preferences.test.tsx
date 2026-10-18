// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/App.tsx";
import {
  applyTheme,
  loadPreferences,
  PreferencesProvider,
  readPreferences,
  resolveLocale,
} from "../src/preferences.tsx";
import { RegistryContext } from "../src/radio/hooks.ts";
import { RadioRegistry, type StorageLike } from "../src/radio/registry.ts";
import { APP_VERSION } from "../src/version.ts";

afterEach(() => {
  cleanup();
  applyTheme("auto");
});

function memory(initial: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

describe("preferences", () => {
  it("reads what was saved, and treats anything else as automatic", () => {
    const saved = (value: string) => readPreferences(memory({ "muga.preferences.v1": value }));
    const auto = { language: "auto", theme: "auto", proxy: "" };
    expect(
      saved('{"language":"es","theme":"dark","proxy":"https://radios.example.com/x"}'),
    ).toEqual({ language: "es", theme: "dark", proxy: "https://radios.example.com" });
    expect(saved('{"language":"fr","theme":"blue","proxy":"http://radios.example.com"}')).toEqual(
      auto,
    );
    expect(saved("not json")).toEqual(auto);
    expect(readPreferences(undefined)).toEqual(auto);
  });

  it("follows the browser's languages unless one was chosen", () => {
    expect(resolveLocale("auto", ["es-ES", "en"])).toBe("es");
    expect(resolveLocale("auto", ["de-DE"])).toBe("en");
    expect(resolveLocale("en", ["es-ES"])).toBe("en");
  });

  it("forces light or dark, and the address bar's colour with it", () => {
    document.head.innerHTML = `
      <meta name="theme-color" content="#f3f6f4" media="(prefers-color-scheme: light)">
      <meta name="theme-color" content="#0c1210" media="(prefers-color-scheme: dark)">`;
    const media = () =>
      [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].map((m) =>
        m.getAttribute("media"),
      );
    applyTheme("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(media()).toEqual(["not all", "all"]);
    applyTheme("auto");
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(media()).toEqual(["(prefers-color-scheme: light)", "(prefers-color-scheme: dark)"]);
  });
});

describe("Muga settings", () => {
  it("changes the language and the theme, and keeps them", async () => {
    const storage = memory();
    const user = userEvent.setup();
    render(
      <PreferencesProvider storage={storage} initial={await loadPreferences(storage)}>
        <RegistryContext.Provider value={new RadioRegistry({ storage })}>
          <App />
        </RegistryContext.Provider>
      </PreferencesProvider>,
    );
    expect(screen.getByRole("heading", { name: "No speakers yet" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Muga settings" }));
    expect(screen.getByText(`Muga ${APP_VERSION}`)).toBeTruthy();
    const language = screen.getByRole("group", { name: "Language" });
    await user.click(within(language).getByRole("button", { name: "Español" }));
    expect(await screen.findByRole("heading", { name: "Ajustes de Muga" })).toBeTruthy();
    expect(document.documentElement.lang).toBe("es");

    await user.click(screen.getByRole("button", { name: "Oscuro" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(JSON.parse(storage.data.get("muga.preferences.v1") ?? "{}")).toEqual({
      language: "es",
      theme: "dark",
      proxy: "",
    });

    await user.click(screen.getByRole("button", { name: "Volver" }));
    expect(screen.getByRole("heading", { name: "Aún no hay altavoces" })).toBeTruthy();
  });

  it("opens from the foot of the speaker list once there are speakers", async () => {
    const storage = memory({
      "muga.radios.v1": JSON.stringify([
        { id: "002261000001", host: "127.0.0.1:1", pin: "1234", name: "Kitchen" },
      ]),
    });
    const registry = new RadioRegistry({ storage });
    const user = userEvent.setup();
    render(
      <PreferencesProvider storage={storage} initial={await loadPreferences(storage)}>
        <RegistryContext.Provider value={registry}>
          <App />
        </RegistryContext.Provider>
      </PreferencesProvider>,
    );
    const sidebar = screen.getByRole("complementary", { name: "Speakers" });
    const entry = within(sidebar).getByRole("button", { name: "Muga settings" });
    const topbar = document.querySelector<HTMLElement>(".topbar");
    if (!topbar) throw new Error("no top bar");
    expect(within(topbar).queryByRole("button", { name: "Muga settings" })).toBeNull();
    await user.click(entry);
    expect(screen.getByRole("heading", { name: "Muga settings" })).toBeTruthy();
    expect(entry.getAttribute("aria-pressed")).toBe("true");
    await user.click(entry);
    expect(screen.queryByRole("heading", { name: "Muga settings" })).toBeNull();
    registry.stop();
  });
});
