import { useRef, useState } from "react";
import { useT } from "../i18n/index.tsx";
import type { RadioController } from "../radio/controller.ts";
import { useDocumentTitle, useMultiroom, useRadio, useRegistry } from "../radio/hooks.ts";
import type { MultiroomGroup } from "../radio/multiroom.ts";
import type { RadioSnapshot } from "../radio/types.ts";
import { GroupEditor } from "./GroupEditor.tsx";
import { Icon } from "./Icon.tsx";
import { Library } from "./Library.tsx";
import { MultiroomStatus } from "./MultiroomNotices.tsx";
import { Notices } from "./Notices.tsx";
import { NowPlaying } from "./NowPlaying.tsx";
import { members } from "./RadioList.tsx";
import { pageTitle, statusLine } from "./status.ts";
import { Transport } from "./Transport.tsx";
import { VolumeSlider } from "./VolumeControl.tsx";

/**
 * A multiroom group, controlled through its server as UNDOK does (doc 05 §5): what the server
 * plays, every speaker plays.
 */
export function GroupView({ groupId }: { groupId: string }) {
  const t = useT();
  const registry = useRegistry();
  const { groups, busy } = useMultiroom();
  const group = groups.find((g) => g.id === groupId);
  const server = useRadio(group?.server.radioId);
  const [editing, setEditing] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  useDocumentTitle(pageTitle(server?.snapshot, t), t("app.name"));
  if (!group || !server) return null;
  const { snapshot, controller } = server;
  const { text, tone } = statusLine(snapshot, t);
  const titleId = `group-${groupId}-title`;

  function closeEditor() {
    setEditing(false);
    requestAnimationFrame(() => editButton.current?.focus());
  }

  function dissolve() {
    if (!group) return;
    if (window.confirm(t("groups.dissolve.confirm", { name: group.name }))) {
      void registry.multiroom.dissolve(group.id);
    }
  }

  return (
    <section className="radio-view" aria-labelledby={titleId}>
      <header className="radio-header">
        <div className="radio-header__text">
          <p className="eyebrow">
            <Icon name="group" size={16} />
            {t("groups.label")} · {t("groups.count", { count: members(group).length })}
          </p>
          <h1 id={titleId}>{group.name}</h1>
          <p className="radio-header__status">
            <span className={`dot dot--${tone}`} aria-hidden="true" />
            {text}
          </p>
        </div>
        <div className="radio-header__actions">
          <button
            type="button"
            className={`button button--compact power-button${snapshot.power ? " button--ghost" : ""}`}
            disabled={snapshot.connection !== "online" || snapshot.power === undefined}
            aria-pressed={snapshot.power === true}
            onClick={() => void controller.setPower(!snapshot.power)}
          >
            <Icon name="power" size={20} />
            <span className="button__text">
              {snapshot.power ? t("power.standby") : t("power.on")}
            </span>
          </button>
          <button
            ref={editButton}
            type="button"
            className="button button--ghost button--compact"
            aria-pressed={editing}
            disabled={busy !== undefined}
            onClick={() => (editing ? closeEditor() : setEditing(true))}
          >
            <Icon name="settings" size={20} />
            <span className="button__text">{t("groups.edit")}</span>
          </button>
        </div>
      </header>

      <MultiroomStatus />
      {/* Standby on the server is standby for the whole group. */}
      <Notices snapshot={snapshot} controller={controller} name={group.name} />

      {editing ? (
        <GroupEditor
          snapshot={snapshot}
          controller={controller}
          group={group}
          onClose={closeEditor}
          onDone={closeEditor}
        />
      ) : (
        <div className="radio-grid">
          <div className="card player">
            <NowPlaying snapshot={snapshot} />
            <Transport snapshot={snapshot} controller={controller} />
            <GroupVolume group={group} snapshot={snapshot} controller={controller} />
          </div>
          <Library snapshot={snapshot} controller={controller} group={group} />
        </div>
      )}

      <footer className="radio-footer">
        <span className="muted">{t("groups.footer", { name: snapshot.name })}</span>
        <button
          type="button"
          className="button button--quiet"
          disabled={busy !== undefined}
          onClick={dissolve}
        >
          <Icon name="close" size={18} />
          {t("groups.dissolve")}
        </button>
      </footer>
    </section>
  );
}

/** The master volume, then each speaker's, all set on the server in its volume steps. */
function GroupVolume({
  group,
  snapshot,
  controller,
}: {
  group: MultiroomGroup;
  snapshot: RadioSnapshot;
  controller: RadioController;
}) {
  const t = useT();
  const mix = snapshot.mixer;
  const max = snapshot.volumeSteps - 1;
  const off = snapshot.connection !== "online" || snapshot.power === false;
  const clientNumbers = group.clients.flatMap((c) => c.clientNumber ?? []);
  const labels = (name: string) => ({
    label: t("groups.volume.speaker", { name }),
    muteLabel: t("groups.volume.mute", { name }),
    unmuteLabel: t("groups.volume.unmute", { name }),
  });

  return (
    <div className="group-volume">
      <VolumeSlider
        title={t("groups.volume.master")}
        label={t("groups.volume.master")}
        value={mix?.master}
        max={max}
        muted={snapshot.muted}
        disabled={off}
        muteLabel={t("groups.volume.muteAll")}
        unmuteLabel={t("groups.volume.unmuteAll")}
        onMute={() => void controller.mixer.setGroupMute(!snapshot.muted, clientNumbers)}
        onChange={(value) => void controller.mixer.setMaster(value)}
      />
      <section className="mixer" aria-label={t("groups.volume.speakers")}>
        <VolumeSlider
          title={snapshot.name}
          {...labels(snapshot.name)}
          value={snapshot.volume}
          max={max}
          muted={snapshot.muted}
          disabled={off}
          onMute={() => void controller.toggleMute()}
          onChange={(value) => void controller.setVolume(value)}
        />
        {group.clients.map((client) => {
          const n = client.clientNumber;
          if (n === undefined) return null;
          const channel = mix?.clients[n];
          const name = client.name || client.ip;
          return (
            <VolumeSlider
              key={client.udn}
              title={name}
              {...labels(name)}
              value={channel?.volume}
              max={max}
              muted={channel?.muted ?? false}
              disabled={off}
              onMute={() => void controller.mixer.setClientMute(n, !channel?.muted)}
              onChange={(value) => void controller.mixer.setClientVolume(n, value)}
            />
          );
        })}
      </section>
    </div>
  );
}
