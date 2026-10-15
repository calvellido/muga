import { type KeyboardEvent, useId, useState } from "react";
import { useT } from "../i18n/index.tsx";
import { hasCap, NavCap } from "../radio/caps.ts";
import type { RadioController } from "../radio/controller.ts";
import type { RadioSnapshot } from "../radio/types.ts";
import { Browse } from "./Browse.tsx";
import { Presets } from "./Presets.tsx";

type Tab = "sources" | "browse" | "presets";

interface Props {
  snapshot: RadioSnapshot;
  controller: RadioController;
}

/** Sources, the source's menu (when it has one) and presets, as ARIA tabs. */
export function Library({ snapshot, controller }: Props) {
  const t = useT();
  const id = useId();
  const [selected, setSelected] = useState<Tab>("sources");

  // nav.caps is per source; while it's unknown, offer the menu and let the radio answer.
  const browsable = snapshot.navCaps === undefined || hasCap(snapshot.navCaps, NavCap.Navigation);
  const tabs: Tab[] = browsable ? ["sources", "browse", "presets"] : ["sources", "presets"];
  const tab = tabs.includes(selected) ? selected : "sources";

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const rtl = document.documentElement.dir === "rtl";
    const steps: Record<string, number> = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 };
    const step = steps[event.key];
    const index =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : step === undefined
            ? undefined
            : (tabs.indexOf(tab) + step + tabs.length) % tabs.length;
    if (index === undefined) return;
    event.preventDefault();
    const next = tabs[index] ?? "sources";
    setSelected(next);
    document.getElementById(`${id}-${next}-tab`)?.focus();
  }

  return (
    <section className="card tabs-card">
      <div className="tabs" role="tablist" aria-label={t("tabs.label")} onKeyDown={onKeyDown}>
        {tabs.map((name) => (
          <button
            key={name}
            id={`${id}-${name}-tab`}
            type="button"
            role="tab"
            className="tab"
            aria-selected={tab === name}
            aria-controls={`${id}-${name}-panel`}
            tabIndex={tab === name ? 0 : -1}
            onClick={() => setSelected(name)}
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
        {tab === "sources" && <SourceList snapshot={snapshot} controller={controller} />}
        {tab === "browse" && <Browse snapshot={snapshot} controller={controller} />}
        {tab === "presets" && <Presets snapshot={snapshot} controller={controller} />}
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
