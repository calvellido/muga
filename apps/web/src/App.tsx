import { useEffect, useRef, useState } from "react";
import { AddRadioForm } from "./components/AddRadioForm.tsx";
import { GroupView } from "./components/GroupView.tsx";
import { Icon } from "./components/Icon.tsx";
import { DiscoveredSpeakers, RadioList } from "./components/RadioList.tsx";
import { RadioView } from "./components/RadioView.tsx";
import { useT } from "./i18n/index.tsx";
import {
  useMediaQuery,
  useMultiroom,
  useRadio,
  useRegistry,
  useRegistrySnapshot,
} from "./radio/hooks.ts";

function Brand() {
  const t = useT();
  return (
    <div className="brand">
      <img src="/icon.svg" alt="" width={32} height={32} />
      <span>{t("app.name")}</span>
    </div>
  );
}

function Welcome() {
  const t = useT();
  return (
    <div className="welcome">
      <img className="welcome__logo" src="/icon.svg" alt="" width={72} height={72} />
      <div>
        <h1>{t("radios.empty.title")}</h1>
        <p className="muted">{t("radios.empty.body")}</p>
      </div>
      <div className="card">
        <AddRadioForm />
      </div>
    </div>
  );
}

export function App() {
  const t = useT();
  const registry = useRegistry();
  const { radios, activeId, activeGroupId } = useRegistrySnapshot();
  const active = useRadio(activeId);
  const activeGroup = useMultiroom().groups.find((g) => g.id === activeGroupId);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  // At narrow widths the sidebar is an off-canvas drawer: keep it out of tab order and the
  // accessibility tree while closed.
  const wide = useMediaQuery("(min-width: 900px)");
  const switcherRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (drawerOpen) closeRef.current?.focus();
    else if (wasOpen.current) switcherRef.current?.focus();
    wasOpen.current = drawerOpen;
  }, [drawerOpen]);

  useEffect(() => {
    registry.start();
    const onVisibility = () => registry.setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      registry.stop();
    };
  }, [registry]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setDrawerOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const closeDrawer = () => {
    setDrawerOpen(false);
    setAdding(false);
  };

  return (
    <div className="app">
      <header className="topbar">
        <Brand />
        {radios.length > 0 && (
          <button
            ref={switcherRef}
            type="button"
            className="switcher"
            aria-expanded={drawerOpen}
            aria-controls="speakers"
            onClick={() => setDrawerOpen(true)}
          >
            <span className="switcher__label">
              {activeGroup?.name ?? active?.snapshot.name ?? t("radios.switch")}
            </span>
            <Icon name="chevronDown" size={18} />
            <span className="visually-hidden">{t("radios.switch")}</span>
          </button>
        )}
      </header>

      {radios.length > 0 && (
        <aside
          id="speakers"
          className={`sidebar${drawerOpen ? " is-open" : ""}`}
          aria-label={t("radios.title")}
          inert={!wide && !drawerOpen}
        >
          <div className="sidebar__header">
            <Brand />
            <button
              ref={closeRef}
              type="button"
              className="icon-button sidebar__close"
              aria-label={t("radios.close")}
              onClick={closeDrawer}
            >
              <Icon name="close" />
            </button>
          </div>
          <h2 className="sidebar__title">{t("radios.title")}</h2>
          <RadioList onSelect={closeDrawer} />
          <DiscoveredSpeakers onAdded={closeDrawer} />
          <div className="sidebar__add">
            {adding ? (
              <AddRadioForm onDone={closeDrawer} onCancel={() => setAdding(false)} />
            ) : (
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setAdding(true)}
              >
                <Icon name="plus" size={20} />
                {t("radios.add")}
              </button>
            )}
          </div>
          <p className="sidebar__footer">{t("app.tagline")}</p>
        </aside>
      )}
      {drawerOpen && (
        <button
          type="button"
          className="backdrop"
          aria-label={t("radios.close")}
          onClick={closeDrawer}
        />
      )}

      <main className="main">
        {radios.length === 0 ? (
          <Welcome />
        ) : activeGroup ? (
          <GroupView key={activeGroup.id} groupId={activeGroup.id} />
        ) : activeId ? (
          <RadioView key={activeId} id={activeId} />
        ) : null}
      </main>
    </div>
  );
}
