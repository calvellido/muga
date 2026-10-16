import { useEffect, useRef, useState } from "react";
import { AppSettings } from "./components/AppSettings.tsx";
import { ConnectForm } from "./components/ConnectForm.tsx";
import { FindSpeakers } from "./components/FindSpeakers.tsx";
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
      <img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" width={32} height={32} />
      <span>{t("app.name")}</span>
    </div>
  );
}

function Welcome() {
  const t = useT();
  return (
    <div className="welcome">
      <img
        className="welcome__logo"
        src={`${import.meta.env.BASE_URL}icon.svg`}
        alt=""
        width={72}
        height={72}
      />
      <div>
        <h1>{t("radios.empty.title")}</h1>
        <p className="muted">{t("radios.empty.body")}</p>
      </div>
      <div className="card welcome__find">
        <FindSpeakers />
        <DiscoveredSpeakers />
      </div>
      <div className="card">
        <ConnectForm />
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
  const [connecting, setConnecting] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
    setConnecting(false);
  };
  // Picking or connecting a speaker shows it, leaving Muga's settings.
  const showSpeaker = () => {
    closeDrawer();
    setSettingsOpen(false);
  };
  // Muga's own settings: at the foot of the speaker list, or in the top bar before there is one.
  const toggleSettings = () => {
    closeDrawer();
    setSettingsOpen((open) => !open);
  };

  return (
    <div className="app">
      <header className="topbar">
        <Brand />
        {radios.length === 0 && (
          <button
            type="button"
            className="icon-button"
            aria-label={t("appSettings.open")}
            aria-pressed={settingsOpen}
            onClick={toggleSettings}
          >
            <Icon name="gear" />
          </button>
        )}
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
          <RadioList onSelect={showSpeaker} />
          <DiscoveredSpeakers onConnected={showSpeaker} />
          <div className="sidebar__connect">
            <FindSpeakers quiet />
            {connecting ? (
              <ConnectForm onDone={showSpeaker} onCancel={() => setConnecting(false)} />
            ) : (
              <button
                type="button"
                className="button button--ghost"
                onClick={() => setConnecting(true)}
              >
                <Icon name="plus" size={20} />
                {t("radios.connect")}
              </button>
            )}
          </div>
          <div className="sidebar__footer">
            <button
              type="button"
              className="sidebar__settings"
              aria-pressed={settingsOpen}
              onClick={toggleSettings}
            >
              <Icon name="gear" size={20} />
              {t("appSettings.open")}
            </button>
            <p className="sidebar__tagline">{t("app.tagline")}</p>
          </div>
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
        {settingsOpen ? (
          <AppSettings onClose={() => setSettingsOpen(false)} />
        ) : radios.length === 0 ? (
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
