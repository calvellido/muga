import { DEFAULT_PIN, isFsapiError } from "@muga/fsapi-core";
import { useId, useState } from "react";
import { useT } from "../i18n/index.tsx";
import {
  useFinder,
  useMultiroom,
  useRadio,
  useRegistry,
  useRegistrySnapshot,
} from "../radio/hooks.ts";
import type { MultiroomGroup, MultiroomSpeaker } from "../radio/multiroom.ts";
import { address } from "../radio/registry.ts";
import { Icon } from "./Icon.tsx";
import { statusLine } from "./status.ts";

export function members(group: MultiroomGroup): MultiroomSpeaker[] {
  return [group.server, ...group.clients];
}

/** A speaker that can be connected: its key, name and address. */
type Candidate = Pick<MultiroomSpeaker, "udn" | "name" | "ip">;

/** Groups to list: those with at least one saved speaker. */
function shownGroups(groups: readonly MultiroomGroup[], saved: ReadonlySet<string>) {
  return groups.filter((g) => members(g).some((s) => s.radioId && saved.has(s.radioId)));
}

/** Connects a speaker found on the network, with the default PIN. */
function useConnectFound(onConnected?: () => void) {
  const t = useT();
  const registry = useRegistry();
  const [connecting, setConnecting] = useState<string>();
  const [error, setError] = useState<{ udn: string; text: string }>();

  async function connect(speaker: Candidate) {
    const name = speaker.name || speaker.ip;
    setConnecting(speaker.udn);
    setError(undefined);
    try {
      await registry.connect(speaker.ip, DEFAULT_PIN);
      onConnected?.();
    } catch (caught) {
      setError({
        udn: speaker.udn,
        text: isFsapiError(caught, "pin")
          ? t("discover.error.pin", { name })
          : t("connect.error.unreachable", { host: speaker.ip }),
      });
    } finally {
      setConnecting(undefined);
    }
  }
  return { connect, connecting, error };
}

function ConnectButton({
  speaker,
  found,
}: {
  speaker: Candidate;
  found: ReturnType<typeof useConnectFound>;
}) {
  const t = useT();
  return (
    <button
      type="button"
      className="button button--ghost button--small"
      aria-label={t("discover.connectLabel", { name: speaker.name || speaker.ip })}
      disabled={found.connecting !== undefined}
      onClick={() => void found.connect(speaker)}
    >
      {found.connecting === speaker.udn ? t("discover.connecting") : t("discover.connect")}
    </button>
  );
}

/** Multiroom groups with their speakers, then the speakers that aren't in a group. */
export function RadioList({ onSelect }: { onSelect?: () => void }) {
  const registry = useRegistry();
  const { radios, activeId, activeGroupId } = useRegistrySnapshot();
  const { groups } = useMultiroom();
  const saved = new Set(radios.map((r) => r.id));
  const isSaved = (s: MultiroomSpeaker) => s.radioId !== undefined && saved.has(s.radioId);
  const shown = shownGroups(groups, saved);
  const found = useConnectFound(onSelect);
  const grouped = new Set(shown.flatMap((g) => members(g).flatMap((s) => s.radioId ?? [])));
  const select = (id: string) => {
    registry.select(id);
    onSelect?.();
  };
  return (
    <ul className="radio-list">
      {shown.map((group) => (
        <GroupListItem
          key={group.id}
          group={group}
          active={group.id === activeGroupId}
          activeId={activeGroupId ? undefined : activeId}
          isSaved={isSaved}
          found={found}
          onSelectGroup={() => {
            registry.selectGroup(group.id);
            onSelect?.();
          }}
          onSelect={select}
        />
      ))}
      {radios
        .filter((radio) => !grouped.has(radio.id))
        .map((radio) => (
          <RadioListItem
            key={radio.id}
            id={radio.id}
            active={!activeGroupId && radio.id === activeId}
            onSelect={() => select(radio.id)}
          />
        ))}
    </ul>
  );
}

function GroupListItem({
  group,
  active,
  activeId,
  isSaved,
  found,
  onSelectGroup,
  onSelect,
}: {
  group: MultiroomGroup;
  active: boolean;
  activeId: string | undefined;
  isSaved: (speaker: MultiroomSpeaker) => boolean;
  found: ReturnType<typeof useConnectFound>;
  onSelectGroup: () => void;
  onSelect: (id: string) => void;
}) {
  const t = useT();
  const server = useRadio(isSaved(group.server) ? group.server.radioId : undefined);
  const status = server
    ? statusLine(server.snapshot, t)
    : { text: t("groups.status.notSaved"), tone: "idle" as const };
  return (
    <li className="group-item">
      <button
        type="button"
        className="radio-item"
        aria-current={active ? "true" : undefined}
        disabled={!server}
        onClick={onSelectGroup}
      >
        <span className={`group-mark group-mark--${status.tone}`} aria-hidden="true">
          <Icon name="group" size={20} />
        </span>
        <span className="radio-item__text">
          <span className="radio-item__name">{group.name}</span>
          <span className="radio-item__status">
            {t("groups.count", { count: members(group).length })} · {status.text}
          </span>
        </span>
      </button>
      <ul className="member-list" aria-label={t("groups.listLabel", { name: group.name })}>
        {members(group).map((speaker) =>
          speaker.radioId && isSaved(speaker) ? (
            <MemberItem
              key={speaker.udn}
              id={speaker.radioId}
              leads={speaker === group.server}
              active={speaker.radioId === activeId}
              onSelect={() => speaker.radioId && onSelect(speaker.radioId)}
            />
          ) : (
            <li key={speaker.udn} className="member member--unsaved">
              <span className="member__name">{speaker.name || speaker.ip}</span>
              {speaker.ip ? (
                <ConnectButton speaker={speaker} found={found} />
              ) : (
                <span className="member__note">{t("groups.status.notSaved")}</span>
              )}
              {found.error?.udn === speaker.udn && (
                <p className="form-error member__error" role="alert">
                  {found.error.text}
                </p>
              )}
            </li>
          ),
        )}
      </ul>
    </li>
  );
}

function MemberItem({
  id,
  leads,
  active,
  onSelect,
}: {
  id: string;
  leads: boolean;
  active: boolean;
  onSelect: () => void;
}) {
  const t = useT();
  const radio = useRadio(id);
  if (!radio) return null;
  const { text, tone } = statusLine(radio.snapshot, t);
  const problem = radio.snapshot.connection !== "online";
  return (
    <li>
      <button
        type="button"
        className="member"
        aria-current={active ? "true" : undefined}
        onClick={onSelect}
      >
        <span className={`dot dot--${tone}`} aria-hidden="true" />
        <span className="member__name">{radio.snapshot.name}</span>
        {(problem || leads) && (
          <span className="member__note">{problem ? text : t("groups.speaker.leads")}</span>
        )}
      </button>
    </li>
  );
}

function RadioListItem({
  id,
  active,
  onSelect,
}: {
  id: string;
  active: boolean;
  onSelect: () => void;
}) {
  const t = useT();
  const radio = useRadio(id);
  if (!radio) return null;
  const { text, tone } = statusLine(radio.snapshot, t);
  return (
    <li>
      <button
        type="button"
        className="radio-item"
        aria-current={active ? "true" : undefined}
        onClick={onSelect}
      >
        <span className={`dot dot--${tone}`} aria-hidden="true" />
        <span className="radio-item__text">
          <span className="radio-item__name">{radio.snapshot.name}</span>
          <span className="radio-item__status">{text}</span>
        </span>
      </button>
    </li>
  );
}

/**
 * Speakers on the network that aren't connected to Muga yet, one tap away: the ones the
 * multiroom lists name, and the ones a scan found (ADR 0011).
 */
export function DiscoveredSpeakers({ onConnected }: { onConnected?: () => void }) {
  const t = useT();
  const id = useId();
  const { radios } = useRegistrySnapshot();
  const { speakers, groups } = useMultiroom();
  const scan = useFinder();
  const found = useConnectFound(onConnected);
  // Members of listed groups are offered in their group instead.
  const inGroups = shownGroups(groups, new Set(radios.map((r) => r.id))).flatMap(members);
  const listed = new Set(inGroups.map((s) => s.udn));
  const fromLists = speakers.filter((s) => !s.radioId && s.ip && !listed.has(s.udn));
  // The scan's finds, unless they're saved already or named above.
  const savedIds = new Set(radios.map((r) => r.id.toUpperCase()));
  const known = new Set(
    [...radios.map((r) => r.host), ...fromLists.map((s) => s.ip), ...inGroups.map((s) => s.ip)].map(
      address,
    ),
  );
  const fromScan: Candidate[] = scan.found
    .filter((r) => !savedIds.has(r.radioId?.toUpperCase() ?? "") && !known.has(address(r.host)))
    .map((r) => ({ udn: `scan:${r.host}`, name: r.name, ip: r.host }));
  const unconnected: Candidate[] = [...fromLists, ...fromScan];
  if (unconnected.length === 0) return null;

  return (
    <section className="discovered" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="sidebar__title">
        {t("discover.title")}
      </h2>
      <p className="discovered__hint">{t("discover.hint")}</p>
      <ul className="radio-list">
        {unconnected.map((speaker) => (
          <li key={speaker.udn} className="discovered__item">
            <span className="radio-item__text">
              <span className="radio-item__name">{speaker.name || speaker.ip}</span>
              <span className="radio-item__status">{speaker.ip}</span>
            </span>
            <ConnectButton speaker={speaker} found={found} />
            {found.error?.udn === speaker.udn && (
              <p className="form-error discovered__error" role="alert">
                {found.error.text}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
