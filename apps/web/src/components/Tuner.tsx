import { useIntl } from "react-intl";
import { useT } from "../i18n/index.tsx";
import type { RadioController } from "../radio/controller.ts";
import type { RadioSnapshot, TunerState } from "../radio/types.ts";
import { IconButton } from "./IconButton.tsx";

/** FM frequency: a dial over the band plus one-step buttons, as in UNDOK. */
export function Tuner({
  tuner,
  snapshot,
  controller,
}: {
  tuner: TunerState;
  snapshot: RadioSnapshot;
  controller: RadioController;
}) {
  const t = useT();
  const intl = useIntl();
  const { lower, upper, step } = tuner;
  const frequency = tuner.frequency ?? lower;
  const mhz = intl.formatNumber(frequency / 1000, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const disabled = snapshot.connection !== "online" || snapshot.power === false;

  return (
    <div className="tuner">
      {/* The dial announces the frequency itself (aria-valuetext). */}
      <p className="tuner__frequency" aria-hidden="true">
        {t("tuner.value", { mhz })}
      </p>
      <div className="tuner__controls">
        <IconButton
          icon="minus"
          label={t("tuner.down")}
          disabled={disabled || frequency <= lower}
          onClick={() => void controller.tuner.step(-1)}
        />
        <input
          className="slider"
          aria-label={t("tuner.label")}
          type="range"
          min={lower}
          max={upper}
          step={step}
          value={frequency}
          disabled={disabled}
          aria-valuetext={t("tuner.value", { mhz })}
          onChange={(e) => void controller.tuner.tune(Number(e.currentTarget.value))}
        />
        <IconButton
          icon="plus"
          label={t("tuner.up")}
          disabled={disabled || frequency >= upper}
          onClick={() => void controller.tuner.step(1)}
        />
      </div>
    </div>
  );
}
