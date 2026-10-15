import { useRef, useState } from "react";
import { useT } from "../i18n/index.tsx";
import { currentModeId } from "../radio/controller.ts";
import { useMultiroom, useRadio, useRegistry } from "../radio/hooks.ts";
import { GroupEditor } from "./GroupEditor.tsx";
import { Icon } from "./Icon.tsx";
import { Library } from "./Library.tsx";
import { GroupMembership, MultiroomStatus } from "./MultiroomNotices.tsx";
import { Notices } from "./Notices.tsx";
import { NowPlaying } from "./NowPlaying.tsx";
import { members } from "./RadioList.tsx";
import { Settings } from "./Settings.tsx";
import { statusLine } from "./status.ts";
import { Transport } from "./Transport.tsx";
import { Tuner } from "./Tuner.tsx";
import { VolumeControl } from "./VolumeControl.tsx";

type Panel = "player" | "settings" | "group";

export function RadioView({ id }: { id: string }) {
  const t = useT();
  const registry = useRegistry();
  const radio = useRadio(id);
  const { speakers, groups, busy } = useMultiroom();
  const [panel, setPanel] = useState<Panel>("player");
  const settingsButton = useRef<HTMLButtonElement>(null);
  const groupButton = useRef<HTMLButtonElement>(null);
  if (!radio) return null;
  const { snapshot, controller } = radio;
  const { text, tone } = statusLine(snapshot, t);
  const canPower = snapshot.connection === "online" && snapshot.power !== undefined;
  const group = groups.find((g) => members(g).some((s) => s.radioId === id));
  // Multiroom speakers that aren't in a group yet can start one.
  const canGroup = speakers.some((s) => s.radioId === id) && !group;
  // A client plays its group's stream: the group is controlled through its server.
  const client = group !== undefined && group.server.radioId !== id;
  const playing = snapshot.connection === "online" && snapshot.power !== false;
  const status =
    client && playing
      ? [t("groups.status.member", { group: group.name }), snapshot.play.name]
          .filter(Boolean)
          .join(" · ")
      : text;

  function close(button: HTMLButtonElement | null) {
    setPanel("player");
    requestAnimationFrame(() => button?.focus());
  }

  function forget() {
    if (window.confirm(t("radio.forget.confirm", { name: snapshot.name }))) registry.forget(id);
  }

  return (
    <section className="radio-view" aria-labelledby={`${id}-title`}>
      <header className="radio-header">
        <div className="radio-header__text">
          <h1 id={`${id}-title`}>{snapshot.name}</h1>
          <p className="radio-header__status">
            <span className={`dot dot--${tone}`} aria-hidden="true" />
            {status}
          </p>
        </div>
        <div className="radio-header__actions">
          {(canGroup || panel === "group") && (
            <button
              ref={groupButton}
              type="button"
              className="button button--ghost button--compact"
              aria-label={t("groups.create.label", { name: snapshot.name })}
              aria-pressed={panel === "group"}
              disabled={busy !== undefined || snapshot.connection !== "online"}
              onClick={() => (panel === "group" ? close(groupButton.current) : setPanel("group"))}
            >
              <Icon name="group" size={20} />
              <span className="button__text">{t("groups.create")}</span>
            </button>
          )}
          <button
            ref={settingsButton}
            type="button"
            className="icon-button"
            aria-label={t("settings.open")}
            title={t("settings.open")}
            aria-pressed={panel === "settings"}
            onClick={() =>
              panel === "settings" ? close(settingsButton.current) : setPanel("settings")
            }
          >
            <Icon name="settings" />
          </button>
          <button
            type="button"
            className={`button button--compact power-button${snapshot.power ? " button--ghost" : ""}`}
            disabled={!canPower}
            aria-pressed={snapshot.power === true}
            onClick={() => void controller.setPower(!snapshot.power)}
          >
            <Icon name="power" size={20} />
            <span className="button__text">
              {snapshot.power ? t("power.standby") : t("power.on")}
            </span>
          </button>
        </div>
      </header>

      <Notices snapshot={snapshot} controller={controller} />
      <MultiroomStatus />
      <GroupMembership snapshot={snapshot} />

      {panel === "settings" ? (
        <Settings
          snapshot={snapshot}
          controller={controller}
          onClose={() => close(settingsButton.current)}
        />
      ) : panel === "group" ? (
        <GroupEditor
          snapshot={snapshot}
          controller={controller}
          onClose={() => close(groupButton.current)}
          onDone={() => registry.selectGroupOf(id)}
        />
      ) : (
        <div className="radio-grid">
          <div className="card player">
            <NowPlaying snapshot={snapshot} />
            {snapshot.tuner && snapshot.power !== false && currentModeId(snapshot) === "FM" && (
              <Tuner tuner={snapshot.tuner} snapshot={snapshot} controller={controller} />
            )}
            {!client && <Transport snapshot={snapshot} controller={controller} />}
            <VolumeControl snapshot={snapshot} controller={controller} />
          </div>
          {!client && <Library snapshot={snapshot} controller={controller} />}
        </div>
      )}

      <footer className="radio-footer">
        <span className="muted">
          {[snapshot.model, snapshot.version].filter(Boolean).join(" · ")}
        </span>
        <button type="button" className="button button--quiet" onClick={forget}>
          <Icon name="trash" size={18} />
          {t("radio.forget")}
        </button>
      </footer>
    </section>
  );
}
