import { createContext, type ReactNode, useCallback, useContext, useState } from "react";
import {
  detectLocale,
  I18nProvider,
  type Locale,
  loadMessages,
  type Messages,
  SUPPORTED_LOCALES,
} from "./i18n/index.tsx";
import { proxyOrigin } from "./radio/proxy.ts";
import type { StorageLike } from "./radio/registry.ts";

/** Muga's own settings (ADR 0014), kept in this browser. "auto" follows the browser or device. */
export interface Preferences {
  language: "auto" | Locale;
  theme: "auto" | "light" | "dark";
  /** An HTTPS proxy at home that reaches the radios (ADR 0017), as `https://host`; "" for none. */
  proxy: string;
}

export const DEFAULT_PREFERENCES: Preferences = { language: "auto", theme: "auto", proxy: "" };
const KEY = "muga.preferences.v1";
const THEMES = ["auto", "light", "dark"] as const;

/** Saved preferences; anything missing, unknown or unreadable counts as automatic. */
export function readPreferences(storage: StorageLike | undefined): Preferences {
  try {
    const saved: Partial<Record<keyof Preferences, unknown>> = JSON.parse(
      storage?.getItem(KEY) ?? "{}",
    );
    const language = SUPPORTED_LOCALES.find((l) => l === saved.language) ?? "auto";
    const theme = THEMES.find((t) => t === saved.theme) ?? "auto";
    const proxy = typeof saved.proxy === "string" ? (proxyOrigin(saved.proxy) ?? "") : "";
    return { language, theme, proxy };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function writePreferences(storage: StorageLike | undefined, preferences: Preferences): void {
  try {
    storage?.setItem(KEY, JSON.stringify(preferences));
  } catch {
    // Storage is best-effort (ADR 0004): the choice still applies until the page is closed.
  }
}

export function browserLanguages(): readonly string[] {
  const { languages, language } = globalThis.navigator ?? {};
  return languages?.length ? languages : language ? [language] : [];
}

/** The language to show for a choice: the browser's, unless one was picked. */
export function resolveLocale(
  choice: Preferences["language"],
  preferred: readonly string[] = browserLanguages(),
): Locale {
  return choice === "auto" ? detectLocale(preferred) : choice;
}

/**
 * Light or dark: "auto" leaves it to the device (`prefers-color-scheme`). The stylesheet's
 * colours use `light-dark()`, so `data-theme` only has to set `color-scheme`. The address bar's
 * colour (`theme-color`) follows too.
 */
export function applyTheme(theme: Preferences["theme"], doc: Document = document): void {
  const root = doc.documentElement;
  if (theme === "auto") delete root.dataset.theme;
  else root.dataset.theme = theme;
  for (const meta of doc.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.dataset.media ??= meta.getAttribute("media") ?? "";
    const scheme = meta.dataset.media.includes("dark") ? "dark" : "light";
    const media = theme === "auto" ? meta.dataset.media : theme === scheme ? "all" : "not all";
    meta.setAttribute("media", media);
  }
}

interface PreferencesValue {
  preferences: Preferences;
  /** The language shown when the choice is automatic. */
  browserLocale: Locale;
  update(patch: Partial<Preferences>): Promise<void>;
}

const PreferencesContext = createContext<PreferencesValue | undefined>(undefined);

export function usePreferences(): PreferencesValue {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error("usePreferences needs a PreferencesProvider");
  return value;
}

/** The preferences when there's a PreferencesProvider (always, except in some tests). */
export function useOptionalPreferences(): Preferences | undefined {
  return useContext(PreferencesContext)?.preferences;
}

export interface InitialPreferences {
  preferences: Preferences;
  locale: Locale;
  messages: Messages;
}

/** Reads the saved preferences and the messages they need, before the first render. */
export async function loadPreferences(
  storage: StorageLike | undefined,
): Promise<InitialPreferences> {
  const preferences = readPreferences(storage);
  applyTheme(preferences.theme);
  const locale = resolveLocale(preferences.language);
  return { preferences, locale, messages: await loadMessages(locale) };
}

/** Holds the preferences, saves changes, and shows the app in the chosen language. */
export function PreferencesProvider({
  storage,
  initial,
  children,
}: {
  storage: StorageLike | undefined;
  initial: InitialPreferences;
  children: ReactNode;
}) {
  const [state, setState] = useState(initial);
  const update = useCallback(
    async (patch: Partial<Preferences>) => {
      const preferences = { ...state.preferences, ...patch };
      writePreferences(storage, preferences);
      applyTheme(preferences.theme);
      const locale = resolveLocale(preferences.language);
      const messages = locale === state.locale ? state.messages : await loadMessages(locale);
      setState({ preferences, locale, messages });
    },
    [storage, state],
  );
  return (
    <PreferencesContext.Provider
      value={{ preferences: state.preferences, browserLocale: resolveLocale("auto"), update }}
    >
      <I18nProvider locale={state.locale} messages={state.messages}>
        {children}
      </I18nProvider>
    </PreferencesContext.Provider>
  );
}
