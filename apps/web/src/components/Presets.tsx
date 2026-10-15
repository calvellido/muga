import { useEffect, useState } from "react";
import { useT } from "../i18n/index.tsx";
import { NO_PRESET } from "../radio/caps.ts";
import type { RadioController } from "../radio/controller.ts";
import { type PresetAbilities, presetAbilities } from "../radio/presets.ts";
import type { Preset, RadioSnapshot } from "../radio/types.ts";
import { IconButton } from "./IconButton.tsx";

interface Props {
  snapshot: RadioSnapshot;
  controller: RadioController;
}

/** Preset recall, plus an edit mode to store, delete and reorder where the radio allows it. */
export function Presets({ snapshot, controller }: Props) {
  const t = useT();
  const { presets, connection, power } = snapshot;
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const stale = presets.status === "idle" || (presets.status === "standby" && power === true);
    if (stale && connection === "online") void controller.presets.load();
  }, [presets.status, connection, power, controller]);

  switch (presets.status) {
    case "idle":
    case "loading":
      if (presets.items.length === 0) {
        return (
          <p className="muted" role="status">
            {t("presets.loading")}
          </p>
        );
      }
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
            onClick={() => void controller.presets.load()}
          >
            {t("presets.retry")}
          </button>
        </div>
      );
  }

  const abilities = presetAbilities(snapshot);
  const canEdit = abilities.store || abilities.remove || abilities.reorder;
  const stored = presets.items.filter((p) => p.name).length;
  const isEditing = editing && canEdit;

  return (
    <div className="presets">
      {canEdit && (
        <div className="panel-toolbar">
          <p className="hint">
            {isEditing ? t("presets.editHint") : t("presets.count", { count: stored })}
          </p>
          <button
            type="button"
            className="button button--ghost button--small"
            aria-pressed={isEditing}
            onClick={() => setEditing(!isEditing)}
          >
            {isEditing ? t("presets.done") : t("presets.edit")}
          </button>
        </div>
      )}
      {stored === 0 && !isEditing && <p className="muted">{t("presets.empty")}</p>}
      {(stored > 0 || isEditing) && (
        <ol className="option-list option-list--single">
          {presets.items.map((preset, index) =>
            isEditing ? (
              <EditRow
                key={preset.key}
                preset={preset}
                index={index}
                snapshot={snapshot}
                controller={controller}
                abilities={abilities}
              />
            ) : (
              <RecallRow
                key={preset.key}
                preset={preset}
                snapshot={snapshot}
                controller={controller}
              />
            ),
          )}
        </ol>
      )}
    </div>
  );
}

function RecallRow({ preset, snapshot, controller }: Props & { preset: Preset }) {
  const t = useT();
  const current = snapshot.currentPreset === NO_PRESET ? undefined : snapshot.currentPreset;
  const playing = preset.key === current;
  return (
    <li>
      <button
        type="button"
        className="option"
        aria-pressed={playing}
        disabled={!preset.name || snapshot.connection !== "online"}
        onClick={() => void controller.presets.select(preset.key)}
      >
        <span className="option__number">{preset.key + 1}</span>
        <span className="option__label">{preset.name || t("presets.emptySlot")}</span>
        {playing && <span className="badge">{t("presets.current")}</span>}
      </button>
    </li>
  );
}

function EditRow({
  preset,
  index,
  snapshot,
  controller,
  abilities,
}: Props & { preset: Preset; index: number; abilities: PresetAbilities }) {
  const t = useT();
  const { key, name } = preset;
  const slot = key + 1;
  const station = snapshot.play.name;
  const items = snapshot.presets.items;
  const busy = snapshot.presets.busyKey !== undefined || snapshot.connection !== "online";

  function store() {
    if (name && !window.confirm(t("presets.replace.confirm", { slot, name, station }))) return;
    void controller.presets.store(key);
  }

  function remove() {
    if (window.confirm(t("presets.delete.confirm", { slot, name }))) {
      void controller.presets.remove(key);
    }
  }

  return (
    <li className="preset-edit" aria-busy={snapshot.presets.busyKey === key}>
      <span className="option__number">{slot}</span>
      <span className={name ? "preset-edit__label" : "preset-edit__label is-empty"}>
        {name || t("presets.emptySlot")}
      </span>
      <span className="preset-edit__actions">
        {abilities.reorder && (
          <>
            <IconButton
              icon="arrowUp"
              label={t("presets.moveUp", { name: name || slot })}
              disabled={busy || !name || index === 0}
              onClick={() => void controller.presets.move(key, -1)}
            />
            <IconButton
              icon="arrowDown"
              label={t("presets.moveDown", { name: name || slot })}
              disabled={busy || !name || index === items.length - 1}
              onClick={() => void controller.presets.move(key, 1)}
            />
          </>
        )}
        {abilities.store && (
          <IconButton
            icon="save"
            label={station ? t("presets.store", { station, slot }) : t("presets.storeNothing")}
            disabled={busy || !station}
            onClick={store}
          />
        )}
        {abilities.remove && (
          <IconButton
            icon="trash"
            label={t("presets.delete", { slot, name: name || slot })}
            disabled={busy || !name}
            onClick={remove}
          />
        )}
      </span>
    </li>
  );
}
