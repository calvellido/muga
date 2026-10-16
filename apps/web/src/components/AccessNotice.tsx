import { useT } from "../i18n/index.tsx";
import type { LocalAccess } from "../radio/access.ts";
import { Icon } from "./Icon.tsx";

/** Why this browser can't reach the radios from this page, or that it will ask (ADR 0010). */
export function AccessNotice({ access }: { access: LocalAccess }) {
  const t = useT();
  if (access === "ask") return <p className="hint access-hint">{t("access.ask")}</p>;
  if (access !== "blocked" && access !== "denied") return null;
  return (
    <div className="notice notice--warn" role="status">
      <Icon name="alert" />
      <div>
        <p className="notice__title">{t(`access.${access}.title`)}</p>
        <p>{t(`access.${access}.body`)}</p>
      </div>
    </div>
  );
}
