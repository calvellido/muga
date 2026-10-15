import { DEFAULT_PIN, isFsapiError } from "@muga/fsapi-core";
import { type FormEvent, useId, useState } from "react";
import { type MessageId, type MessageValues, useT } from "../i18n/index.tsx";
import { useRegistry } from "../radio/hooks.ts";

function describeError(error: unknown, host: string): [MessageId, MessageValues] {
  if (!isFsapiError(error)) return ["connect.error.other", { message: String(error) }];
  switch (error.kind) {
    case "pin":
      return ["connect.error.pin", {}];
    case "network":
    case "timeout":
      return ["connect.error.unreachable", { host }];
    case "parse":
    case "not-found":
    case "http":
    case "status":
      return ["connect.error.notRadio", { host }];
    default:
      return ["connect.error.other", { message: error.message }];
  }
}

export function ConnectForm({ onDone, onCancel }: { onDone?: () => void; onCancel?: () => void }) {
  const t = useT();
  const registry = useRegistry();
  const id = useId();
  const [host, setHost] = useState("");
  const [pin, setPin] = useState(DEFAULT_PIN);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<[MessageId, MessageValues]>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const target = host.trim();
    if (!target || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await registry.connect(target, pin.trim() || DEFAULT_PIN);
      setHost("");
      onDone?.();
    } catch (caught) {
      setError(describeError(caught, target));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="connect-form" onSubmit={submit} aria-labelledby={`${id}-title`} noValidate>
      <h2 id={`${id}-title`} className="connect-form__title">
        {t("connect.title")}
      </h2>
      <div className="field">
        <label htmlFor={`${id}-host`}>{t("connect.host.label")}</label>
        <input
          id={`${id}-host`}
          name="host"
          value={host}
          onChange={(e) => setHost(e.currentTarget.value)}
          placeholder="192.168.1.50"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          required
          aria-describedby={`${id}-host-hint`}
          aria-invalid={error ? true : undefined}
        />
        <span id={`${id}-host-hint`} className="hint">
          {t("connect.host.hint")}
        </span>
      </div>
      <div className="field">
        <label htmlFor={`${id}-pin`}>{t("connect.pin.label")}</label>
        <input
          id={`${id}-pin`}
          name="pin"
          value={pin}
          onChange={(e) => setPin(e.currentTarget.value)}
          inputMode="numeric"
          autoComplete="off"
          aria-describedby={`${id}-pin-hint`}
        />
        <span id={`${id}-pin-hint`} className="hint">
          {t("connect.pin.hint")}
        </span>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {t(error[0], error[1])}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="button" disabled={busy || !host.trim()}>
          {busy ? t("connect.connecting") : t("connect.submit")}
        </button>
        {onCancel && (
          <button type="button" className="button button--ghost" onClick={onCancel} disabled={busy}>
            {t("connect.cancel")}
          </button>
        )}
      </div>
    </form>
  );
}
