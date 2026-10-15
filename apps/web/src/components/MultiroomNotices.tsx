import { useEffect } from "react";
import { useT } from "../i18n/index.tsx";
import { useMultiroom, useRegistry } from "../radio/hooks.ts";
import type { RadioSnapshot } from "../radio/types.ts";
import { Icon } from "./Icon.tsx";
import { members } from "./RadioList.tsx";

/** A group change in progress, or the one that failed. */
export function MultiroomStatus() {
  const t = useT();
  const { multiroom: directory } = useRegistry();
  const { busy, lastError } = useMultiroom();
  useEffect(() => {
    if (!lastError) return;
    const timer = setTimeout(() => directory.clearError(), 10_000);
    return () => clearTimeout(timer);
  }, [lastError, directory]);
  if (busy) {
    return (
      <div className="notice" role="status">
        <Icon name="group" />
        <p>{t("groups.applying")}</p>
      </div>
    );
  }
  if (!lastError) return null;
  return (
    <div className="notice notice--danger" role="alert">
      <Icon name="alert" />
      <p>{t("error.action", { message: lastError.message })}</p>
      <button
        type="button"
        className="button button--ghost notice__action"
        onClick={() => directory.clearError()}
      >
        {t("error.dismiss")}
      </button>
    </div>
  );
}

/** On a speaker's own page: the group it plays with, with a way there and a way out. */
export function GroupMembership({ snapshot }: { snapshot: RadioSnapshot }) {
  const t = useT();
  const registry = useRegistry();
  const { groups, busy } = useMultiroom();
  const id = snapshot.config.id;
  const group = groups.find((g) => members(g).some((s) => s.radioId === id));
  if (!group) return null;
  const leads = group.server.radioId === id;
  const values = { name: snapshot.name, group: group.name };

  function leave() {
    if (!group) return;
    if (window.confirm(t("groups.leave.confirm", values))) void registry.multiroom.leave(id);
  }

  return (
    <div className="notice">
      <Icon name="group" />
      <p>{leads ? t("groups.member.server", values) : t("groups.member.client", values)}</p>
      <div className="notice__actions">
        <button
          type="button"
          className="button button--small"
          disabled={!group.server.radioId}
          onClick={() => registry.selectGroup(group.id)}
        >
          {t("groups.open")}
        </button>
        <button
          type="button"
          className="button button--ghost button--small"
          disabled={busy !== undefined}
          onClick={leave}
        >
          {t("groups.leave")}
        </button>
      </div>
    </div>
  );
}
