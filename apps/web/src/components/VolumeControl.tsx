import { type CSSProperties, useId } from "react";
import { useT } from "../i18n/index.tsx";
import type { RadioController } from "../radio/controller.ts";
import type { RadioSnapshot } from "../radio/types.ts";
import { IconButton } from "./IconButton.tsx";

export function VolumeControl({
  snapshot,
  controller,
}: {
  snapshot: RadioSnapshot;
  controller: RadioController;
}) {
  const t = useT();
  const id = useId();
  const max = Math.max(1, snapshot.volumeSteps - 1);
  const value = snapshot.volume ?? 0;
  const disabled =
    snapshot.connection !== "online" || snapshot.power === false || snapshot.volume === undefined;

  return (
    <div className="volume">
      <IconButton
        icon={snapshot.muted ? "muted" : "volume"}
        label={snapshot.muted ? t("volume.unmute") : t("volume.mute")}
        pressed={snapshot.muted}
        disabled={disabled}
        onClick={() => void controller.toggleMute()}
      />
      <label className="visually-hidden" htmlFor={id}>
        {t("volume.label")}
      </label>
      <input
        id={id}
        className="slider"
        type="range"
        min={0}
        max={max}
        step={1}
        value={value}
        disabled={disabled}
        aria-valuetext={t("volume.value", { value, max })}
        style={{ "--fill": `${(value / max) * 100}%` } as CSSProperties}
        onChange={(e) => void controller.setVolume(Number(e.currentTarget.value))}
      />
      <output className="volume__value" htmlFor={id}>
        {value}
      </output>
    </div>
  );
}
