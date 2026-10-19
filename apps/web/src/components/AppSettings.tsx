import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { LANGUAGE_NAMES, SUPPORTED_LOCALES, useT } from "../i18n/index.tsx";
import { type Preferences, usePreferences } from "../preferences.tsx";
import { useRegistry } from "../radio/hooks.ts";
import { proxyOrigin } from "../radio/proxy.ts";
import { APP_VERSION } from "../version.ts";
import { ChipGroup } from "./ChipGroup.tsx";
import { Icon } from "./Icon.tsx";

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
        <ProxyCard />
      </div>
      <p className="muted app-settings__note">{t("appSettings.note")}</p>
      <p className="hint">{t("appSettings.version", { version: APP_VERSION })}</p>
    </section>
  );
}

/** Where the guide to setting up a proxy lives (docs/proxy). */
const PROXY_GUIDE = "https://github.com/calvellido/muga/blob/main/docs/proxy/README.md";

type ProxyCheck =
  | { status: "idle" | "checking" | "invalid" | "failed" }
  | { status: "ok"; ranges: string[] };

/** An HTTPS proxy at home that reaches the radios, for browsers that can't (ADR 0017). */
function ProxyCard() {
  const t = useT();
  const id = useId();
  const registry = useRegistry();
  const { preferences, update } = usePreferences();
  const [draft, setDraft] = useState(preferences.proxy);
  const [check, setCheck] = useState<ProxyCheck>({ status: "idle" });

  async function use(event: FormEvent) {
    event.preventDefault();
    const proxy = proxyOrigin(draft);
    if (!proxy) {
      setCheck({ status: "invalid" });
      return;
    }
    setCheck({ status: "checking" });
    try {
      const { ranges } = await registry.checkProxy(proxy);
      await update({ proxy });
      setDraft(proxy);
      setCheck({ status: "ok", ranges });
    } catch {
      setCheck({ status: "failed" });
    }
  }

  async function stop() {
    await update({ proxy: "" });
    setDraft("");
    setCheck({ status: "idle" });
  }

  return (
    <form className="card settings-card" onSubmit={use}>
      <h3>{t("appSettings.proxy.title")}</h3>
      <p className="hint">
        {t("appSettings.proxy.hint")}{" "}
        <a href={PROXY_GUIDE} target="_blank" rel="noreferrer">
          {t("appSettings.proxy.guide")}
        </a>
      </p>
      <div className="field">
        <label htmlFor={`${id}-proxy`}>{t("appSettings.proxy.label")}</label>
        <input
          id={`${id}-proxy`}
          type="url"
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          placeholder="https://radios.example.com"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={check.status === "invalid" || check.status === "failed" ? true : undefined}
        />
      </div>
      <div className="form-actions">
        <button
          type="submit"
          className="button button--small"
          disabled={check.status === "checking" || !draft.trim()}
        >
          {t(check.status === "checking" ? "appSettings.proxy.checking" : "appSettings.proxy.use")}
        </button>
        {preferences.proxy && (
          <button type="button" className="button button--ghost button--small" onClick={stop}>
            {t("appSettings.proxy.stop")}
          </button>
        )}
      </div>
      <ProxyStatus check={check} proxy={preferences.proxy} />
    </form>
  );
}

function ProxyStatus({ check, proxy }: { check: ProxyCheck; proxy: string }) {
  const t = useT();
  if (check.status === "invalid" || check.status === "failed") {
    return (
      <p className="form-error" role="alert">
        {t(`appSettings.proxy.${check.status}`)}
      </p>
    );
  }
  if (!proxy) return null;
  return (
    <p role="status">
      {t("appSettings.proxy.active", { proxy })}
      {check.status === "ok" && check.ranges.length > 0 && (
        <>
          {" "}
          {t("appSettings.proxy.ranges", { ranges: check.ranges.map((r) => `${r}.x`).join(", ") })}
        </>
      )}
    </p>
  );
}
