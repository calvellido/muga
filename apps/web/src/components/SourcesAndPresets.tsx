import { type KeyboardEvent, useEffect, useId, useState } from "react";
import { useT } from "../i18n/index.tsx";
import { NO_PRESET } from "../radio/caps.ts";
import type { RadioController } from "../radio/controller.ts";
import type { RadioSnapshot } from "../radio/types.ts";

type Tab = "sources" | "presets";
const TABS: readonly Tab[] = ["sources", "presets"];

interface Props {
  snapshot: RadioSnapshot;
  controller: RadioController;
}

export function SourcesAndPresets({ snapshot, controller }: Props) {
  const t = useT();
  const id = useId();
  const [tab, setTab] = useState<Tab>("sources");

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = TABS[(TABS.indexOf(tab) + 1) % TABS.length] ?? "sources";
    setTab(next);
    document.getElementById(`${id}-${next}-tab`)?.focus();
  }

  return (
    <section className="card tabs-card">
      <div className="tabs" role="tablist" aria-label={t("tabs.label")} onKeyDown={onKeyDown}>
        {TABS.map((name) => (
          <button
            key={name}
            id={`${id}-${name}-tab`}
            type="button"
            role="tab"
            className="tab"
            aria-selected={tab === name}
            aria-controls={`${id}-${name}-panel`}
            tabIndex={tab === name ? 0 : -1}
            onClick={() => setTab(name)}
          >
            {t(`tabs.${name}`)}
          </button>
        ))}
      </div>
      <div
        id={`${id}-${tab}-panel`}
        role="tabpanel"
        aria-labelledby={`${id}-${tab}-tab`}
        className="panel"
      >
        {tab === "sources" ? (
          <SourceList snapshot={snapshot} controller={controller} />
        ) : (
          <PresetList snapshot={snapshot} controller={controller} />
        )}
      </div>
    </section>
  );
}

function SourceList({ snapshot, controller }: Props) {
  const t = useT();
  if (snapshot.modes.length === 0) return <p className="muted">{t("sources.empty")}</p>;
  return (
    <ul className="option-list">
      {snapshot.modes.map((mode) => {
        const current = snapshot.power !== false && mode.key === snapshot.modeKey;
        return (
          <li key={mode.key}>
            <button
              type="button"
              className="option option--stacked"
              aria-pressed={current}
              disabled={snapshot.connection !== "online"}
              onClick={() => void controller.setMode(mode.key)}
            >
              <span className="option__label">{mode.label || mode.id}</span>
              {current && <span className="badge">{t("sources.current")}</span>}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function PresetList({ snapshot, controller }: Props) {
  const t = useT();
  const { presets, connection, power } = snapshot;

  useEffect(() => {
    const stale = presets.status === "idle" || (presets.status === "standby" && power === true);
    if (stale && connection === "online") void controller.loadPresets();
  }, [presets.status, connection, power, controller]);

  switch (presets.status) {
    case "idle":
    case "loading":
      if (presets.items.length === 0) return <p className="muted">{t("presets.loading")}</p>;
      break;
    case "standby":
      return <p className="muted">{t("presets.standby")}</p>;
    case "unsupported":
      return <p className="muted">{t("presets.unsupported")}</p>;
    case "error":
      return (
        <div className="muted">
          <p>{t("presets.error")}</p>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => void controller.loadPresets()}
          >
            {t("presets.retry")}
          </button>
        </div>
      );
  }

  if (!presets.items.some((p) => p.name)) return <p className="muted">{t("presets.empty")}</p>;
  const current = snapshot.currentPreset === NO_PRESET ? undefined : snapshot.currentPreset;

  return (
    <ol className="option-list option-list--single">
      {presets.items.map((preset) => (
        <li key={preset.key}>
          <button
            type="button"
            className="option"
            aria-pressed={preset.key === current}
            disabled={!preset.name || connection !== "online"}
            onClick={() => void controller.selectPreset(preset.key)}
          >
            <span className="option__number">{preset.key + 1}</span>
            <span className="option__label">{preset.name || t("presets.emptySlot")}</span>
            {preset.key === current && <span className="badge">{t("presets.current")}</span>}
          </button>
        </li>
      ))}
    </ol>
  );
}
