import type { IntlShape } from "react-intl";
import type { MessageId, MessageValues } from "../i18n/index.tsx";
import { hasPlayback, isPlaying } from "../radio/controller.ts";
import type { PlayStatus, RadioSnapshot } from "../radio/types.ts";

type T = (id: MessageId, values?: MessageValues) => string;

export type StatusTone = "live" | "idle" | "warn";

export function playStatusLabel(status: PlayStatus | undefined, t: T): string {
  return typeof status === "string"
    ? t(`playStatus.${status}` as MessageId)
    : t("playStatus.unknown");
}

/** The current source's name, as the radio labels it. */
export function sourceLabel(s: RadioSnapshot): string {
  const mode = s.modes.find((m) => m.key === s.modeKey);
  return mode?.label || mode?.id || "";
}

/** One-line summary for the speaker list and header: connection problems first, then what's playing. */
export function statusLine(s: RadioSnapshot, t: T): { text: string; tone: StatusTone } {
  if (s.connection === "connecting") return { text: t("status.connecting"), tone: "idle" };
  if (s.connection === "offline") return { text: t("status.offline"), tone: "warn" };
  if (s.connection === "pin-required") return { text: t("status.pinRequired"), tone: "warn" };
  if (s.power === false) return { text: t("status.standby"), tone: "idle" };
  const mode = sourceLabel(s);
  const what = s.play.name || playStatusLabel(s.play.status, t);
  return {
    text: mode ? `${mode} · ${what}` : what,
    tone: isPlaying(s.play.status) ? "live" : "idle",
  };
}

/** What the page's title starts with: a mark, to keep it short. */
function titleMark(status: PlayStatus | undefined, muted: boolean): string {
  if (status === "PAUSED") return "⏸";
  if (status === "BUFFERING" || status === "REBUFFERING") return "⏳";
  return muted ? "🔇" : "▶";
}

/**
 * The page's title, for tabs and an installed app's window: what the speaker or group on screen
 * plays, first, since titles are cut at the end. `name` is the speaker's or group's, and `muted`
 * whether that speaker is muted. Just the app's name when nothing plays.
 */
export function pageTitle(s: RadioSnapshot | undefined, name: string, t: T, muted = false): string {
  const track = s && (s.play.name || sourceLabel(s));
  if (!s || !name || !track || !hasPlayback(s)) return t("app.name");
  const what = s.play.artist ? `${track} - ${s.play.artist}` : track;
  return t("title.nowPlaying", { mark: titleMark(s.play.status, muted), what, name });
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
