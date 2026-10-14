import { useT } from "../i18n/index.tsx";
import { useRadio, useRegistry } from "../radio/hooks.ts";
import { Icon } from "./Icon.tsx";
import { Notices } from "./Notices.tsx";
import { NowPlaying } from "./NowPlaying.tsx";
import { SourcesAndPresets } from "./SourcesAndPresets.tsx";
import { statusLine } from "./status.ts";
import { Transport } from "./Transport.tsx";
import { VolumeControl } from "./VolumeControl.tsx";

export function RadioView({ id }: { id: string }) {
  const t = useT();
  const registry = useRegistry();
  const radio = useRadio(id);
  if (!radio) return null;
  const { snapshot, controller } = radio;
  const { text, tone } = statusLine(snapshot, t);
  const canPower = snapshot.connection === "online" && snapshot.power !== undefined;

  function forget() {
    if (window.confirm(t("radio.forget.confirm", { name: snapshot.name }))) registry.remove(id);
  }

  return (
    <section className="radio-view" aria-labelledby={`${id}-title`}>
      <header className="radio-header">
        <div className="radio-header__text">
          <h1 id={`${id}-title`}>{snapshot.name}</h1>
          <p className="radio-header__status">
            <span className={`dot dot--${tone}`} aria-hidden="true" />
            {text}
          </p>
        </div>
        <button
          type="button"
          className={`button power-button${snapshot.power ? " button--ghost" : ""}`}
          disabled={!canPower}
          aria-pressed={snapshot.power === true}
          onClick={() => void controller.setPower(!snapshot.power)}
        >
          <Icon name="power" size={20} />
          {snapshot.power ? t("power.standby") : t("power.on")}
        </button>
      </header>

      <Notices snapshot={snapshot} controller={controller} />

      <div className="radio-grid">
        <div className="card player">
          <NowPlaying snapshot={snapshot} />
          <Transport snapshot={snapshot} controller={controller} />
          <VolumeControl snapshot={snapshot} controller={controller} />
        </div>
        <SourcesAndPresets snapshot={snapshot} controller={controller} />
      </div>

      <footer className="radio-footer">
        <span className="muted">
          {[snapshot.model, snapshot.version].filter(Boolean).join(" · ")}
        </span>
        <button type="button" className="button button--quiet" onClick={forget}>
          <Icon name="trash" size={18} />
          {t("radio.forget")}
        </button>
      </footer>
    </section>
  );
}
