import { useT } from "../i18n/index.tsx";
import { useFinder, useRegistry, useRegistrySnapshot } from "../radio/hooks.ts";
import { Icon } from "./Icon.tsx";

/**
 * Looks for radios on the network when pressed (ADR 0011). What it finds shows up under
 * "On your network", ready to connect.
 */
export function FindSpeakers({ quiet = false }: { quiet?: boolean }) {
  const t = useT();
  const { finder } = useRegistry();
  const { radios } = useRegistrySnapshot();
  const { status, done, total, found } = useFinder();
  const saved = new Set(radios.map((r) => r.id.toUpperCase()));
  const fresh = found.filter((r) => !saved.has(r.radioId?.toUpperCase() ?? "")).length;

  if (status === "scanning") {
    return (
      <div className="find find--scanning" role="status">
        <p className="find__progress">
          {total > 0 ? t("find.scanning", { done, total }) : t("find.starting")}
        </p>
        <progress max={Math.max(1, total)} value={done} aria-hidden="true" />
        <button
          type="button"
          className="button button--ghost button--small"
          onClick={() => finder.cancel()}
        >
          {t("find.cancel")}
        </button>
      </div>
    );
  }

  return (
    <div className="find">
      <button
        type="button"
        className={quiet ? "button button--ghost" : "button"}
        onClick={() => void finder.scan()}
      >
        <Icon name="search" size={20} />
        {t("find.button")}
      </button>
      {status === "done" && (
        <p className="hint" role="status">
          {total === 0 ? t("find.noNetwork") : t("find.done", { count: fresh })}
        </p>
      )}
      {status === "cancelled" && (
        <p className="hint" role="status">
          {t("find.cancelled")}
        </p>
      )}
    </div>
  );
}
