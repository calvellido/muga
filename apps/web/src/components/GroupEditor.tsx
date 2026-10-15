import { MAX_GROUP_CLIENTS } from "@muga/fsapi-core";
import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { type MessageValues, useT } from "../i18n/index.tsx";
import type { RadioController } from "../radio/controller.ts";
import { useMultiroom, useRegistry } from "../radio/hooks.ts";
import type { MultiroomGroup, MultiroomSpeaker } from "../radio/multiroom.ts";
import type { RadioSnapshot } from "../radio/types.ts";
import { Icon } from "./Icon.tsx";

type T = ReturnType<typeof useT>;

interface Props {
  /** The speaker that leads (or will lead) the group. */
  snapshot: RadioSnapshot;
  controller: RadioController;
  /** Absent: a new group led by `snapshot`'s speaker. */
  group?: MultiroomGroup | undefined;
  onClose(): void;
  /** The change was applied. */
  onDone(): void;
}

const key = (udn: string) => udn.trim().toUpperCase();

/** "Group 1", "Group 2", …: the first name no group has, as UNDOK names new groups. */
export function nextGroupName(t: T, taken: (name: string) => boolean): string {
  for (let number = 1; ; number++) {
    const name = t("groups.name.default", { number });
    if (!taken(name)) return name;
  }
}

/**
 * Picks the speakers of a group and its name. Speakers that can't join say why: another
 * multiroom version, a stereo pair, leading another group, or a full group.
 */
export function GroupEditor({ snapshot, controller, group, onClose, onDone }: Props) {
  const t = useT();
  const id = useId();
  const { multiroom: directory } = useRegistry();
  const { speakers, busy } = useMultiroom();
  const leader = group?.server ?? speakers.find((s) => s.radioId === snapshot.config.id);
  const [name, setName] = useState(
    () => group?.name ?? nextGroupName(t, (n) => directory.nameTaken(n)),
  );
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(group ? [group.server, ...group.clients].map((s) => key(s.udn)) : []),
  );
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => title.current?.focus(), []);

  if (!leader) return null;
  const leaderKey = key(leader.udn);
  const creating = !group;
  const others = speakers.filter((s) => key(s.udn) !== leaderKey);
  const trimmed = name.trim();
  // A new group: the leader plus the speakers picked. An edit: the speakers picked.
  const count = creating ? selected.size + 1 : selected.size;
  const full = count >= MAX_GROUP_CLIENTS + 1;
  const mode = snapshot.modes.find((m) => m.key === snapshot.modeKey);
  // Only a new group needs the leader's source to be shareable; a group already plays one.
  const unshareable = creating && mode?.streamable === 0;
  const shareable = snapshot.modes.filter((m) => m.streamable === 1);
  const renamed = !creating && trimmed !== "" && trimmed !== group.name;
  const leaderLeaves = !creating && !selected.has(leaderKey);
  const next = leaderLeaves
    ? [...group.clients, ...others].find((s) => selected.has(key(s.udn)))
    : undefined;
  const working = busy !== undefined;
  const current = group ? [group.server, ...group.clients].map((s) => key(s.udn)) : [];
  const membersChanged =
    selected.size !== current.length || current.some((udn) => !selected.has(udn));
  const canSubmit =
    !working &&
    trimmed !== "" &&
    !unshareable &&
    (creating ? selected.size > 0 : membersChanged || renamed);

  function blocked(speaker: MultiroomSpeaker): [Parameters<T>[0], MessageValues] | undefined {
    if (speaker.stereo.role === "SECONDARY") return ["groups.speaker.stereo", {}];
    if (leader?.syncVersion && speaker.syncVersion && speaker.syncVersion !== leader.syncVersion) {
      return ["groups.speaker.version", {}];
    }
    if (speaker.role === "SERVER" && speaker.groupId !== group?.id) {
      return ["groups.speaker.leadsOther", { group: speaker.groupName }];
    }
    return undefined;
  }

  function note(speaker: MultiroomSpeaker): string | undefined {
    if (group && key(speaker.udn) === key(group.server.udn)) return t("groups.speaker.leads");
    if (speaker.groupId && speaker.groupId !== group?.id) {
      return t("groups.speaker.inGroup", { group: speaker.groupName });
    }
    return speaker.radioId ? undefined : t("groups.speaker.notSaved");
  }

  function toggle(udn: string) {
    setSelected((current) => {
      const updated = new Set(current);
      if (updated.has(udn)) updated.delete(udn);
      else updated.add(udn);
      return updated;
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    if (creating) {
      if (snapshot.power === false && !(await controller.setPower(true))) return;
      if (await directory.create(snapshot.config.id, [...selected], trimmed)) onDone();
    } else if (await directory.edit(group.id, { name: trimmed, members: [...selected] })) {
      onDone();
    }
  }

  const listed = creating ? others : [leader, ...others];
  return (
    <form className="group-editor" onSubmit={submit} aria-labelledby={`${id}-title`}>
      <div className="settings__header">
        <button
          type="button"
          className="button button--ghost button--small"
          onClick={onClose}
          disabled={working}
        >
          <Icon name="back" size={18} />
          {t("groups.back")}
        </button>
        <h2 id={`${id}-title`} ref={title} tabIndex={-1}>
          {creating ? t("groups.create.title") : t("groups.edit.title", { name: group.name })}
        </h2>
      </div>

      <div className="card group-editor__card">
        {creating && <p>{t("groups.create.hint", { name: snapshot.name })}</p>}

        {unshareable && (
          <div className="notice notice--warn">
            <Icon name="alert" />
            <div>
              <p className="notice__title">
                {t("groups.source.title", { source: mode?.label || mode?.id })}
              </p>
              <p>{t("groups.source.pick")}</p>
              <div className="chips">
                {shareable.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    className="chip"
                    disabled={snapshot.connection !== "online"}
                    onClick={() => void controller.setMode(m.key)}
                  >
                    {m.label || m.id}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="field">
          <label htmlFor={`${id}-name`}>{t("groups.name.label")}</label>
          <input
            id={`${id}-name`}
            value={name}
            maxLength={64}
            autoComplete="off"
            disabled={working}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          {trimmed && directory.nameTaken(trimmed, group?.id) && (
            <p className="hint">{t("groups.name.taken")}</p>
          )}
          {renamed && <p className="hint">{t("groups.name.renameHint")}</p>}
        </div>

        <fieldset className="speaker-picks" disabled={working}>
          <legend>{t("groups.speakers.label")}</legend>
          <p className="hint">{t("groups.speakers.hint", { max: MAX_GROUP_CLIENTS + 1 })}</p>
          {creating && (
            <label className="pick pick--fixed">
              <input type="checkbox" checked disabled />
              <span className="pick__text">
                <span className="pick__name">{snapshot.name}</span>
                <span className="pick__note">{t("groups.speaker.leads")}</span>
              </span>
            </label>
          )}
          {listed.length === 0 && <p className="muted">{t("groups.speakers.none")}</p>}
          {listed.map((speaker) => {
            const udn = key(speaker.udn);
            const checked = selected.has(udn);
            const reason = blocked(speaker);
            const disabled = (reason !== undefined && !checked) || (!checked && full);
            const hint = reason ? t(reason[0], reason[1]) : note(speaker);
            return (
              <label key={udn} className={`pick${disabled ? " pick--disabled" : ""}`}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => toggle(udn)}
                />
                <span className="pick__text">
                  <span className="pick__name">{speaker.name || speaker.ip}</span>
                  {hint && <span className="pick__note">{hint}</span>}
                </span>
              </label>
            );
          })}
        </fieldset>

        {!creating && selected.size < 2 && <p className="hint">{t("groups.tooFew")}</p>}
        {next && selected.size >= 2 && (
          <p className="hint">
            {t("groups.handOver", { name: leader.name, next: next.name || next.ip })}
          </p>
        )}

        <div className="form-actions">
          <button type="submit" className="button" disabled={!canSubmit}>
            {working
              ? t("groups.applying")
              : creating
                ? t("groups.create.submit")
                : selected.size < 2
                  ? t("groups.dissolve")
                  : t("groups.edit.submit")}
          </button>
          <button
            type="button"
            className="button button--ghost"
            onClick={onClose}
            disabled={working}
          >
            {t("groups.cancel")}
          </button>
        </div>
      </div>
    </form>
  );
}
