import { useEffect, useRef } from "react";
import { LANGUAGE_NAMES, SUPPORTED_LOCALES, useT } from "../i18n/index.tsx";
import { type Preferences, usePreferences } from "../preferences.tsx";
import { APP_VERSION } from "../version.ts";
import { Icon } from "./Icon.tsx";
import { ChipGroup } from "./Settings.tsx";

const THEMES = ["auto", "light", "dark"] as const satisfies readonly Preferences["theme"][];

/** Muga's own settings, for this browser (ADR 0014); a speaker's are in its Settings. */
export function AppSettings({ onClose }: { onClose(): void }) {
  const t = useT();
  const { preferences, browserLocale, update } = usePreferences();
  // Keyboard and screen reader users land on the new view's title.
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => title.current?.focus(), []);

  return (
    <section className="settings" aria-labelledby="app-settings-title">
      <div className="settings__header">
        <button type="button" className="button button--ghost button--small" onClick={onClose}>
          <Icon name="back" size={18} />
          {t("appSettings.back")}
        </button>
        <h2 id="app-settings-title" ref={title} tabIndex={-1}>
          {t("appSettings.title")}
        </h2>
      </div>
      <div className="settings-grid">
        <div className="card settings-card">
          <h3>{t("appSettings.language.title")}</h3>
          <ChipGroup label={t("appSettings.language.title")}>
            <button
              type="button"
              className="chip"
              aria-pressed={preferences.language === "auto"}
              onClick={() => void update({ language: "auto" })}
            >
              {t("appSettings.language.auto", { language: LANGUAGE_NAMES[browserLocale] })}
            </button>
            {SUPPORTED_LOCALES.map((locale) => (
              <button
                key={locale}
                type="button"
                className="chip"
                lang={locale}
                aria-pressed={preferences.language === locale}
                onClick={() => void update({ language: locale })}
              >
                {LANGUAGE_NAMES[locale]}
              </button>
            ))}
          </ChipGroup>
          <p className="hint">{t("appSettings.language.hint")}</p>
        </div>
        <div className="card settings-card">
          <h3>{t("appSettings.theme.title")}</h3>
          <ChipGroup label={t("appSettings.theme.title")}>
            {THEMES.map((theme) => (
              <button
                key={theme}
                type="button"
                className="chip"
                aria-pressed={preferences.theme === theme}
                onClick={() => void update({ theme })}
              >
                {t(`appSettings.theme.${theme}`)}
              </button>
            ))}
          </ChipGroup>
          <p className="hint">{t("appSettings.theme.hint")}</p>
        </div>
      </div>
      <p className="muted app-settings__note">{t("appSettings.note")}</p>
      <p className="hint">{t("appSettings.version", { version: APP_VERSION })}</p>
    </section>
  );
}
