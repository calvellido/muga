import { useT } from "../i18n/index.tsx";
import { hasCap, PlayCap } from "../radio/caps.ts";
import { isPlaying, type RadioController } from "../radio/controller.ts";
import type { RadioSnapshot } from "../radio/types.ts";
import { IconButton } from "./IconButton.tsx";

export function Transport({
  snapshot,
  controller,
}: {
  snapshot: RadioSnapshot;
  controller: RadioController;
}) {
  const t = useT();
  const { play } = snapshot;
  const disabled = snapshot.connection !== "online" || snapshot.power === false;
  const playing = isPlaying(play.status);
  const canPause = hasCap(play.caps, PlayCap.Pause) || !hasCap(play.caps, PlayCap.Stop);
  const main = playing ? (canPause ? "pause" : "stop") : "play";

  return (
    <fieldset className="transport">
      <legend className="visually-hidden">{t("controls.label")}</legend>
      <IconButton
        icon="shuffle"
        label={t("controls.shuffle")}
        pressed={play.shuffle}
        hidden={!hasCap(play.caps, PlayCap.Shuffle)}
        disabled={disabled}
        onClick={() => void controller.setShuffle(!play.shuffle)}
      />
      <IconButton
        icon="previous"
        label={t("controls.previous")}
        hidden={!hasCap(play.caps, PlayCap.SkipPrevious)}
        disabled={disabled}
        onClick={() => void controller.control("PREVIOUS")}
        size={28}
      />
      <IconButton
        className="transport__main"
        icon={main}
        label={t(`controls.${main}`)}
        disabled={disabled}
        onClick={() => void controller.togglePlay()}
        size={30}
      />
      <IconButton
        icon="next"
        label={t("controls.next")}
        hidden={!hasCap(play.caps, PlayCap.SkipNext)}
        disabled={disabled}
        onClick={() => void controller.control("NEXT")}
        size={28}
      />
      <IconButton
        icon={play.repeat === "REPEAT_ONE" ? "repeatOne" : "repeat"}
        label={t(`controls.repeat.${play.repeat}`)}
        pressed={play.repeat !== "OFF"}
        hidden={!hasCap(play.caps, PlayCap.Repeat)}
        disabled={disabled}
        onClick={() => void controller.cycleRepeat()}
      />
    </fieldset>
  );
}
