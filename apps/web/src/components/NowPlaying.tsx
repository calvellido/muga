import { useState } from "react";
import { useIntl } from "react-intl";
import { useT } from "../i18n/index.tsx";
import { isPlaying } from "../radio/controller.ts";
import { useNow } from "../radio/hooks.ts";
import type { RadioSnapshot } from "../radio/types.ts";
import { Icon } from "./Icon.tsx";
import { formatDuration, playStatusLabel } from "./status.ts";

function Artwork({ url, name }: { url: string; name: string }) {
  const t = useT();
  const [failed, setFailed] = useState(false);
  return (
    <div className="artwork">
      {url && !failed ? (
        <img
          src={url}
          alt={t("nowPlaying.artworkAlt", { name })}
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <Icon name="radio" size={96} />
      )}
    </div>
  );
}

function Progress({ position, duration }: { position: number; duration: number }) {
  const t = useT();
  const intl = useIntl();
  const percent = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;
  const positionText = formatDuration(position, intl);
  const durationText = formatDuration(duration, intl);
  return (
    <div className="progress">
      <div
        className="progress__track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={Math.round(duration / 1000)}
        aria-valuenow={Math.round(position / 1000)}
        aria-valuetext={t("nowPlaying.progress", {
          position: positionText,
          duration: durationText,
        })}
      >
        <div className="progress__bar" style={{ inlineSize: `${percent}%` }} />
      </div>
      <div className="progress__times">
        <span>{positionText}</span>
        <span>{durationText}</span>
      </div>
    </div>
  );
}

export function NowPlaying({ snapshot }: { snapshot: RadioSnapshot }) {
  const t = useT();
  const { play } = snapshot;
  const playing = isPlaying(play.status);
  const now = useNow(1_000, playing && play.durationMs > 0);
  const position =
    playing && play.positionAt > 0
      ? Math.min(play.durationMs, play.positionMs + Math.max(0, now - play.positionAt))
      : play.positionMs;

  const title = play.name || t("nowPlaying.nothing");
  // As UNDOK: "artist · album", else the album, else the free text (doc 05 §2.1).
  const subtitle = play.artist
    ? [play.artist, play.album].filter(Boolean).join(" · ")
    : play.album || play.text;
  const extra = play.artist && play.text && play.text !== subtitle ? play.text : "";

  return (
    <article className="now-playing">
      <Artwork key={play.artworkUrl} url={play.artworkUrl} name={title} />
      <div className="now-playing__meta">
        <p className={`now-playing__status${playing ? " is-live" : ""}`}>
          {snapshot.power === false ? t("status.standby") : playStatusLabel(play.status, t)}
        </p>
        <h2 className="now-playing__title">{title}</h2>
        {subtitle && <p className="now-playing__subtitle">{subtitle}</p>}
        {extra && <p className="now-playing__extra">{extra}</p>}
        {play.durationMs > 0 && <Progress position={position} duration={play.durationMs} />}
      </div>
    </article>
  );
}
