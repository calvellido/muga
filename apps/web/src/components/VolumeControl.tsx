import { type CSSProperties, useId } from "react";
import { useT } from "../i18n/index.tsx";
import type { RadioController } from "../radio/controller.ts";
import type { RadioSnapshot } from "../radio/types.ts";
import { IconButton } from "./IconButton.tsx";

interface SliderProps {
  /** Accessible name of the slider. */
  label: string;
  /** Shown above the slider, when it isn't the only one. */
  title?: string | undefined;
  value: number | undefined;
  /** Highest step (`sys.caps.volumeSteps` - 1). */
  max: number;
  muted: boolean;
  disabled: boolean;
  muteLabel: string;
  unmuteLabel: string;
  onMute(): void;
  onChange(value: number): void;
}

/** A mute button, a volume slider and its value. */
export function VolumeSlider({
  label,
  title,
  value,
  max,
  muted,
  disabled,
  muteLabel,
  unmuteLabel,
  onMute,
  onChange,
}: SliderProps) {
  const t = useT();
  const id = useId();
  const shown = value ?? 0;
  const top = Math.max(1, max);
  const off = disabled || value === undefined;
  return (
    <div className={title ? "volume volume--titled" : "volume"}>
      {title && (
        <span className="volume__title" aria-hidden="true">
          {title}
        </span>
      )}
      <IconButton
        icon={muted ? "muted" : "volume"}
        label={muted ? unmuteLabel : muteLabel}
        pressed={muted}
        disabled={off}
        onClick={onMute}
      />
      <label className="visually-hidden" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        className="slider"
        type="range"
        min={0}
        max={top}
        step={1}
        value={shown}
        disabled={off}
        aria-valuetext={t("volume.value", { value: shown, max: top })}
        style={{ "--fill": `${(shown / top) * 100}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
      />
      <output className="volume__value" htmlFor={id}>
        {shown}
      </output>
    </div>
  );
}

export function VolumeControl({
  snapshot,
  controller,
}: {
  snapshot: RadioSnapshot;
  controller: RadioController;
}) {
  const t = useT();
  return (
    <VolumeSlider
      label={t("volume.label")}
      value={snapshot.volume}
      max={snapshot.volumeSteps - 1}
      muted={snapshot.muted}
      disabled={snapshot.connection !== "online" || snapshot.power === false}
      muteLabel={t("volume.mute")}
      unmuteLabel={t("volume.unmute")}
      onMute={() => void controller.toggleMute()}
      onChange={(value) => void controller.setVolume(value)}
    />
  );
}
