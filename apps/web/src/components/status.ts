import type { IntlShape } from "react-intl";
import type { MessageId, MessageValues } from "../i18n/index.tsx";
import { isPlaying } from "../radio/controller.ts";
import type { PlayStatus, RadioSnapshot } from "../radio/types.ts";

type T = (id: MessageId, values?: MessageValues) => string;

export type StatusTone = "live" | "idle" | "warn";

export function playStatusLabel(status: PlayStatus | undefined, t: T): string {
  return typeof status === "string"
    ? t(`playStatus.${status}` as MessageId)
    : t("playStatus.unknown");
}

/** One-line summary for the speaker list and header: connection problems first, then what's playing. */
export function statusLine(s: RadioSnapshot, t: T): { text: string; tone: StatusTone } {
  if (s.connection === "connecting") return { text: t("status.connecting"), tone: "idle" };
  if (s.connection === "offline") return { text: t("status.offline"), tone: "warn" };
  if (s.connection === "pin-required") return { text: t("status.pinRequired"), tone: "warn" };
  if (s.power === false) return { text: t("status.standby"), tone: "idle" };
  const mode = s.modes.find((m) => m.key === s.modeKey)?.label;
  const what = s.play.name || playStatusLabel(s.play.status, t);
  return {
    text: mode ? `${mode} · ${what}` : what,
    tone: isPlaying(s.play.status) ? "live" : "idle",
  };
}

export function formatDuration(ms: number, intl: IntlShape): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const two = (n: number) => intl.formatNumber(n, { minimumIntegerDigits: 2, useGrouping: false });
  return hours > 0
    ? `${intl.formatNumber(hours)}:${two(minutes)}:${two(seconds)}`
    : `${intl.formatNumber(minutes)}:${two(seconds)}`;
}
