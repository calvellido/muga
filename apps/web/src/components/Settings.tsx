import { type FormEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useIntl } from "react-intl";
import { type MessageId, useT } from "../i18n/index.tsx";
import type { RadioController } from "../radio/controller.ts";
import { useNow, useRegistry } from "../radio/hooks.ts";
import {
  currentZone,
  NAME_MAX_BYTES,
  radioTime,
  SLEEP_MINUTES,
  zoneLabel,
} from "../radio/settings.ts";
import type { ClockSource, RadioSnapshot, UpdateCheck } from "../radio/types.ts";
import { Icon } from "./Icon.tsx";

interface Props {
  snapshot: RadioSnapshot;
  controller: RadioController;
}

const encoder = new TextEncoder();

/** A row of toggle chips with a label for assistive technology. */
export function ChipGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="chips">
      <legend className="visually-hidden">{label}</legend>
      {children}
    </fieldset>
  );
}

/** Speaker settings and device information; each card shows only when the radio supports it. */
export function Settings({ snapshot, controller, onClose }: Props & { onClose(): void }) {
  const t = useT();
  const { settings, connection } = snapshot;
  const online = connection === "online";

  useEffect(() => {
    if (online) void controller.settings.load();
  }, [online, controller]);

  // The radio counts the sleep timer down; read it now and then to stay in step.
  const sleeping = (settings.sleep?.remaining ?? 0) > 0;
  useEffect(() => {
    if (!sleeping) return;
    const timer = setInterval(() => void controller.settings.refreshSleep(), 30_000);
    return () => clearInterval(timer);
  }, [sleeping, controller]);

  const loading = settings.status === "loading" && !settings.device;
  // Keyboard and screen reader users land on the new view's title.
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => title.current?.focus(), []);

  return (
    <section className="settings" aria-labelledby="settings-title">
      <div className="settings__header">
        <button type="button" className="button button--ghost button--small" onClick={onClose}>
          <Icon name="back" size={18} />
          {t("settings.back")}
        </button>
        <h2 id="settings-title" ref={title} tabIndex={-1}>
          {t("settings.title")}
        </h2>
      </div>
      {loading && (
        <p className="muted" role="status">
          {t("settings.loading")}
        </p>
      )}
      {settings.status === "error" && (
        <div className="muted">
          <p>{t("settings.error")}</p>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => void controller.settings.load()}
          >
            {t("settings.retry")}
          </button>
        </div>
      )}
      {settings.device && (
        <div className="settings-grid">
          <NameCard snapshot={snapshot} controller={controller} />
          <SleepCard snapshot={snapshot} controller={controller} />
          <EqCard snapshot={snapshot} controller={controller} />
          <QualityCard snapshot={snapshot} controller={controller} />
          <ClockCard snapshot={snapshot} controller={controller} />
          <LanguageCard snapshot={snapshot} controller={controller} />
          <DeviceCard snapshot={snapshot} controller={controller} />
        </div>
      )}
    </section>
  );
}

function NameCard({ snapshot, controller }: Props) {
  const t = useT();
  const id = useId();
  const registry = useRegistry();
  const [name, setName] = useState(snapshot.name);
  const [saved, setSaved] = useState(false);
  const trimmed = name.trim();
  const tooLong = encoder.encode(trimmed).length > NAME_MAX_BYTES;
  const unchanged = trimmed === snapshot.name;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaved(false);
    if (await controller.settings.rename(trimmed)) {
      registry.rename(snapshot.config.id, trimmed);
      setSaved(true);
    }
  }

  return (
    <form className="card settings-card" onSubmit={submit}>
      <h3>{t("settings.name.title")}</h3>
      <div className="field">
        <label htmlFor={id}>{t("settings.name.label")}</label>
        <input
          id={id}
          value={name}
          autoComplete="off"
          maxLength={NAME_MAX_BYTES}
          aria-invalid={tooLong}
          onChange={(e) => {
            setName(e.currentTarget.value);
            setSaved(false);
          }}
        />
        <p className="hint">{t("settings.name.hint", { max: NAME_MAX_BYTES })}</p>
      </div>
      {tooLong && <p className="form-error">{t("settings.name.tooLong")}</p>}
      <div className="form-actions">
        <button
          type="submit"
          className="button"
          disabled={!trimmed || tooLong || unchanged || snapshot.connection !== "online"}
        >
          {t("settings.name.save")}
        </button>
        {saved && (
          <span className="hint" role="status">
            {t("settings.saved")}
          </span>
        )}
      </div>
    </form>
  );
}

function SleepCard({ snapshot, controller }: Props) {
  const t = useT();
  const sleep = snapshot.settings.sleep;
  const now = useNow(1_000, (sleep?.remaining ?? 0) > 0);
  if (!sleep) return null;
  const left = Math.max(0, sleep.remaining - Math.floor((now - sleep.readAt) / 1000));
  const disabled = snapshot.connection !== "online" || snapshot.power === false;

  return (
    <div className="card settings-card">
      <h3>{t("settings.sleep.title")}</h3>
      <p className="muted" role="status">
        {left > 0
          ? t("settings.sleep.active", { minutes: Math.ceil(left / 60) })
          : t("settings.sleep.off")}
      </p>
      <ChipGroup label={t("settings.sleep.title")}>
        {SLEEP_MINUTES.map((minutes) => (
          <button
            key={minutes}
            type="button"
            className="chip"
            disabled={disabled}
            onClick={() => void controller.settings.setSleep(minutes)}
          >
            {t("settings.sleep.minutes", { minutes })}
          </button>
        ))}
        {left > 0 && (
          <button
            type="button"
            className="chip"
            disabled={disabled}
            onClick={() => void controller.settings.setSleep(0)}
          >
            {t("settings.sleep.cancel")}
          </button>
        )}
      </ChipGroup>
    </div>
  );
}

function EqCard({ snapshot, controller }: Props) {
  const t = useT();
  const id = useId();
  const eq = snapshot.settings.eq;
  if (!eq) return null;
  const disabled = snapshot.connection !== "online";
  const custom = eq.current === 0;

  return (
    <div className="card settings-card">
      <h3>{t("settings.eq.title")}</h3>
      <ChipGroup label={t("settings.eq.presets")}>
        {eq.presets.map((preset) => (
          <button
            key={preset.key}
            type="button"
            className="chip"
            aria-pressed={preset.key === eq.current}
            disabled={disabled}
            onClick={() => void controller.settings.selectEq(preset.key)}
          >
            {preset.label || t("settings.eq.preset", { key: preset.key })}
          </button>
        ))}
      </ChipGroup>
      {custom &&
        eq.bands.map((band) => {
          const value = band.value ?? 0;
          return (
            <div className="eq-band" key={band.key}>
              <label htmlFor={`${id}-${band.key}`}>{band.label}</label>
              <input
                id={`${id}-${band.key}`}
                className="slider"
                type="range"
                min={band.min}
                max={band.max}
                step={1}
                value={value}
                disabled={disabled}
                onChange={(e) =>
                  void controller.settings.setEqBand(band.key, Number(e.currentTarget.value))
                }
              />
              <output htmlFor={`${id}-${band.key}`}>{value > 0 ? `+${value}` : value}</output>
            </div>
          );
        })}
      {!custom && eq.bands.length > 0 && <p className="hint">{t("settings.eq.customHint")}</p>}
      {eq.loudness !== undefined && (
        <label className="toggle">
          <input
            type="checkbox"
            checked={eq.loudness}
            disabled={disabled}
            onChange={(e) => void controller.settings.setLoudness(e.currentTarget.checked)}
          />
          {t("settings.eq.loudness")}
        </label>
      )}
    </div>
  );
}

const QUALITIES = ["LOW", "NORMAL", "HIGH"] as const;

function QualityCard({ snapshot, controller }: Props) {
  const t = useT();
  const quality = snapshot.settings.quality;
  if (!quality) return null;
  return (
    <div className="card settings-card">
      <h3>{t("settings.quality.title")}</h3>
      <p className="hint">{t("settings.quality.hint")}</p>
      <ChipGroup label={t("settings.quality.title")}>
        {QUALITIES.map((value) => (
          <button
            key={value}
            type="button"
            className="chip"
            aria-pressed={quality.value === value}
            disabled={snapshot.connection !== "online"}
            onClick={() => void controller.settings.setQuality(value)}
          >
            {t(`settings.quality.${value}`)}
          </button>
        ))}
      </ChipGroup>
    </div>
  );
}

const SOURCE_LABELS: Record<ClockSource, MessageId> = {
  SNTP: "settings.clock.source.SNTP",
  DAB: "settings.clock.source.DAB",
  FM: "settings.clock.source.FM",
  MANUAL: "settings.clock.source.MANUAL",
};

function ClockCard({ snapshot, controller }: Props) {
  const t = useT();
  const intl = useIntl();
  const id = useId();
  const clock = snapshot.settings.clock;
  const now = useNow(1_000, clock !== undefined);
  if (!clock) return null;
  const disabled = snapshot.connection !== "online";
  const time = radioTime(clock, now);
  const zone = currentZone(clock);

  return (
    <div className="card settings-card">
      <h3>{t("settings.clock.title")}</h3>
      {time && (
        <p className="clock-now">
          <span className="clock-now__time">
            {intl.formatTime(time, {
              hour: "numeric",
              minute: "2-digit",
              ...(clock.format ? { hour12: clock.format === "12" } : {}),
            })}
          </span>
          <span className="muted">{intl.formatDate(time, { dateStyle: "full" })}</span>
        </p>
      )}
      {clock.format && (
        <ChipGroup label={t("settings.clock.format")}>
          {(["24", "12"] as const).map((format) => (
            <button
              key={format}
              type="button"
              className="chip"
              aria-pressed={clock.format === format}
              disabled={disabled}
              onClick={() => void controller.settings.setClockFormat(format)}
            >
              {t(format === "24" ? "settings.clock.24h" : "settings.clock.12h")}
            </button>
          ))}
        </ChipGroup>
      )}
      {clock.sources.length > 0 && (
        <div className="field">
          <label htmlFor={`${id}-source`}>{t("settings.clock.source")}</label>
          <select
            id={`${id}-source`}
            value={clock.source ?? ""}
            disabled={disabled}
            onChange={(e) =>
              void controller.settings.setClockSource(e.currentTarget.value as ClockSource)
            }
          >
            {!clock.source && <option value="" />}
            {clock.sources.map((source) => (
              <option key={source} value={source}>
                {t(SOURCE_LABELS[source])}
              </option>
            ))}
          </select>
        </div>
      )}
      {clock.source === "SNTP" && clock.zones.length > 0 && (
        <div className="field">
          <label htmlFor={`${id}-zone`}>{t("settings.clock.zone")}</label>
          <select
            id={`${id}-zone`}
            value={zone?.key ?? ""}
            disabled={disabled}
            onChange={(e) => void controller.settings.setTimeZone(Number(e.currentTarget.value))}
          >
            {!zone && <option value="" />}
            {clock.zones.map((z) => (
              <option key={z.key} value={z.key}>
                {zoneLabel(z)}
              </option>
            ))}
          </select>
        </div>
      )}
      {clock.source === "SNTP" && clock.dst !== undefined && (
        <label className="toggle">
          <input
            type="checkbox"
            checked={clock.dst}
            disabled={disabled}
            onChange={(e) => void controller.settings.setDst(e.currentTarget.checked)}
          />
          {t("settings.clock.dst")}
        </label>
      )}
      {clock.source === "MANUAL" && (
        <button
          type="button"
          className="button button--ghost"
          disabled={disabled}
          onClick={() => void controller.settings.setDateTime(new Date())}
        >
          {t("settings.clock.useDevice")}
        </button>
      )}
    </div>
  );
}

function LanguageCard({ snapshot, controller }: Props) {
  const t = useT();
  const id = useId();
  const language = snapshot.settings.language;
  if (!language) return null;
  return (
    <div className="card settings-card">
      <h3>{t("settings.language.title")}</h3>
      <div className="field">
        <label htmlFor={id}>{t("settings.language.label")}</label>
        <select
          id={id}
          value={language.current ?? ""}
          disabled={snapshot.connection !== "online"}
          onChange={(e) => void controller.settings.setLanguage(Number(e.currentTarget.value))}
        >
          {language.current === undefined && <option value="" />}
          {language.options.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
            </option>
          ))}
        </select>
        <p className="hint">{t("settings.language.hint")}</p>
      </div>
    </div>
  );
}

function DeviceCard({ snapshot, controller }: Props) {
  const t = useT();
  const { device, update } = snapshot.settings;
  if (!device) return null;
  const rows: [MessageId, string][] = [
    ["settings.device.model", device.model],
    ["settings.device.version", device.version],
    ["settings.device.ip", snapshot.config.host],
    [
      "settings.device.network",
      device.network === "ethernet"
        ? t("settings.device.ethernet")
        : device.network === "wifi"
          ? device.ssid
            ? t("settings.device.wifiNamed", { ssid: device.ssid })
            : t("settings.device.wifi")
          : "",
    ],
    ["settings.device.mac", device.mac],
    ["settings.device.radioId", device.radioId],
    ["settings.device.serial", device.serial],
  ];

  return (
    <div className="card settings-card">
      <h3>{t("settings.device.title")}</h3>
      <dl className="facts">
        {rows
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <div key={label}>
              <dt>{t(label)}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        {device.signal !== undefined && (
          <div>
            <dt>{t("settings.device.signal")}</dt>
            <dd className="signal">
              <meter min={0} max={100} value={Math.min(100, device.signal)} />
              <span>{device.signal}</span>
            </dd>
          </div>
        )}
      </dl>
      <div className="update-check">
        <button
          type="button"
          className="button button--ghost button--small"
          disabled={update?.status === "checking" || snapshot.connection !== "online"}
          onClick={() => void controller.settings.checkUpdate()}
        >
          {t(update?.status === "checking" ? "settings.update.checking" : "settings.update.check")}
        </button>
        <UpdateResult update={update} />
      </div>
    </div>
  );
}

/** What the radio found at its own last check: Muga only reads it (ADR 0007). */
function UpdateResult({ update }: { update: UpdateCheck | undefined }) {
  const t = useT();
  if (!update || update.status === "checking") return null;
  if (update.status === "available") {
    return (
      <div role="status">
        <p>
          {t(update.important ? "settings.update.important" : "settings.update.available", {
            version: update.version,
          })}
        </p>
        {update.summary && <p className="hint">{update.summary}</p>}
      </div>
    );
  }
  return (
    <p role="status">
      {update.status === "updating"
        ? t("settings.update.updating", { progress: update.progress })
        : t(`settings.update.${update.status}`)}
    </p>
  );
}
