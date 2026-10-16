import { type ReactNode, useCallback, useEffect } from "react";
import { IntlProvider, useIntl } from "react-intl";
import en from "./messages/en.json";

/** Message ids are the keys of the English source catalog; other locales must have the same keys. */
export type MessageId = keyof typeof en;
export type Messages = Record<MessageId, string>;
export type MessageValues = Record<string, string | number | boolean | Date | null | undefined>;

export const SUPPORTED_LOCALES = ["en", "es"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** Each language's name in that language, as language pickers show them. */
export const LANGUAGE_NAMES: Record<Locale, string> = { en: "English", es: "Español" };

/** Add a language: create messages/<locale>.json and a lazy loader here (`() => import(...)`). */
const LOADERS: Record<Locale, () => Promise<Partial<Messages>>> = {
  en: async () => en,
  es: async () => (await import("./messages/es.json")).default,
};

const RTL_LANGUAGES = new Set(["ar", "fa", "he", "ur"]);

export function detectLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const lower = tag.toLowerCase();
    const match = SUPPORTED_LOCALES.find((l) => lower === l || lower.startsWith(`${l}-`));
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}

/** Missing keys fall back to English. */
export async function loadMessages(locale: Locale): Promise<Messages> {
  return { ...en, ...(await LOADERS[locale]()) };
}

export function I18nProvider({
  locale,
  messages,
  children,
}: {
  locale: Locale;
  messages: Messages;
  children: ReactNode;
}) {
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = RTL_LANGUAGES.has(locale.split("-")[0] ?? "") ? "rtl" : "ltr";
  }, [locale]);
  return (
    <IntlProvider locale={locale} defaultLocale={DEFAULT_LOCALE} messages={messages}>
      {children}
    </IntlProvider>
  );
}

/** Typed translate function: `t("volume.value", { value, max })`. */
export function useT(): (id: MessageId, values?: MessageValues) => string {
  const intl = useIntl();
  return useCallback(
    (id: MessageId, values?: MessageValues) => intl.formatMessage({ id }, values),
    [intl],
  );
}
