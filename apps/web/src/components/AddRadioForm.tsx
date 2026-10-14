import { DEFAULT_PIN, isFsapiError } from "@muga/fsapi-core";
import { type FormEvent, useId, useState } from "react";
import { type MessageId, type MessageValues, useT } from "../i18n/index.tsx";
import { useRegistry } from "../radio/hooks.ts";

function describeError(error: unknown, host: string): [MessageId, MessageValues] {
  if (!isFsapiError(error)) return ["add.error.other", { message: String(error) }];
  switch (error.kind) {
    case "pin":
      return ["add.error.pin", {}];
    case "network":
    case "timeout":
      return ["add.error.unreachable", { host }];
    case "parse":
    case "not-found":
    case "http":
    case "status":
      return ["add.error.notRadio", { host }];
    default:
      return ["add.error.other", { message: error.message }];
  }
}

export function AddRadioForm({ onDone, onCancel }: { onDone?: () => void; onCancel?: () => void }) {
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
      await registry.add(target, pin.trim() || DEFAULT_PIN);
      setHost("");
      onDone?.();
    } catch (caught) {
      setError(describeError(caught, target));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="add-form" onSubmit={submit} aria-labelledby={`${id}-title`} noValidate>
      <h2 id={`${id}-title`} className="add-form__title">
        {t("add.title")}
      </h2>
      <div className="field">
        <label htmlFor={`${id}-host`}>{t("add.host.label")}</label>
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
          {t("add.host.hint")}
        </span>
      </div>
      <div className="field">
        <label htmlFor={`${id}-pin`}>{t("add.pin.label")}</label>
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
          {t("add.pin.hint")}
        </span>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {t(error[0], error[1])}
        </p>
      )}
      <div className="form-actions">
        <button type="submit" className="button" disabled={busy || !host.trim()}>
          {busy ? t("add.adding") : t("add.submit")}
        </button>
        {onCancel && (
          <button type="button" className="button button--ghost" onClick={onCancel} disabled={busy}>
            {t("add.cancel")}
          </button>
        )}
      </div>
    </form>
  );
}
