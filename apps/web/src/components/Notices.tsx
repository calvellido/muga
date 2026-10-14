import { type FormEvent, useEffect, useId, useState } from "react";
import { useT } from "../i18n/index.tsx";
import type { RadioController } from "../radio/controller.ts";
import { useRegistry } from "../radio/hooks.ts";
import type { RadioSnapshot } from "../radio/types.ts";
import { Icon } from "./Icon.tsx";

interface Props {
  snapshot: RadioSnapshot;
  controller: RadioController;
}

/** Connection problems, standby and the last failed action, most important first. */
export function Notices({ snapshot, controller }: Props) {
  const t = useT();
  const { connection, power, name } = snapshot;

  if (connection === "pin-required") return <PinPrompt snapshot={snapshot} />;
  if (connection === "offline") {
    return (
      <div className="notice notice--warn" role="status">
        <Icon name="alert" />
        <div>
          <p className="notice__title">{t("radio.offline.title", { name })}</p>
          <p>{t("radio.offline.body")}</p>
        </div>
      </div>
    );
  }
  return (
    <>
      {connection === "online" && power === false && (
        <div className="notice">
          <Icon name="power" />
          <div>
            <p className="notice__title">{t("radio.standby.title", { name })}</p>
            <p>{t("radio.standby.body")}</p>
          </div>
        </div>
      )}
      <ActionError snapshot={snapshot} controller={controller} />
    </>
  );
}

function ActionError({ snapshot, controller }: Props) {
  const t = useT();
  const error = snapshot.lastError;
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => controller.clearError(), 8_000);
    return () => clearTimeout(timer);
  }, [error, controller]);
  if (!error || error.kind === "network" || error.kind === "timeout" || error.kind === "pin")
    return null;
  return (
    <div className="notice notice--danger" role="alert">
      <Icon name="alert" />
      <p>{t("error.action", { message: error.message })}</p>
      <button
        type="button"
        className="button button--ghost notice__action"
        onClick={() => controller.clearError()}
      >
        {t("error.dismiss")}
      </button>
    </div>
  );
}

function PinPrompt({ snapshot }: { snapshot: RadioSnapshot }) {
  const t = useT();
  const id = useId();
  const registry = useRegistry();
  const [pin, setPin] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (pin.trim()) registry.updatePin(snapshot.config.id, pin.trim());
  }

  return (
    <form className="notice notice--warn pin-form" onSubmit={submit}>
      <Icon name="lock" />
      <div className="pin-form__body">
        <p className="notice__title">{t("radio.pin.title", { name: snapshot.name })}</p>
        <p>{t("radio.pin.body")}</p>
        <div className="pin-form__row">
          <label className="visually-hidden" htmlFor={id}>
            {t("add.pin.label")}
          </label>
          <input
            id={id}
            value={pin}
            onChange={(e) => setPin(e.currentTarget.value)}
            inputMode="numeric"
            autoComplete="off"
          />
          <button type="submit" className="button" disabled={!pin.trim()}>
            {t("radio.pin.save")}
          </button>
        </div>
      </div>
    </form>
  );
}
