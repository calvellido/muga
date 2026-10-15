import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { useT } from "../i18n/index.tsx";
import type { RadioController } from "../radio/controller.ts";
import type { BrowseCrumb, BrowseItem, RadioSnapshot } from "../radio/types.ts";
import { Icon } from "./Icon.tsx";
import { IconButton } from "./IconButton.tsx";

interface Props {
  snapshot: RadioSnapshot;
  controller: RadioController;
}

/** The current source's menu: folders, playable items, search and paging. */
export function Browse({ snapshot, controller }: Props) {
  const t = useT();
  const { browse, connection, power, modeKey } = snapshot;
  const online = connection === "online";

  useEffect(() => {
    if (!online || power !== true) return;
    if (browse.status === "idle" || browse.modeKey !== modeKey) void controller.browse.open();
  }, [online, power, browse.status, browse.modeKey, modeKey, controller]);

  if (power === false) return <p className="muted">{t("browse.standby")}</p>;
  switch (browse.status) {
    case "idle":
    case "loading":
      if (browse.items.length === 0 && browse.path.length === 0) {
        return (
          <p className="muted" role="status">
            {t("browse.loading")}
          </p>
        );
      }
      break;
    case "unsupported":
      return <p className="muted">{t("browse.unsupported")}</p>;
    case "error":
      return (
        <div className="muted">
          <p>{t("browse.error")}</p>
          <button
            type="button"
            className="button button--ghost"
            onClick={() => void controller.browse.open()}
          >
            {t("browse.retry")}
          </button>
        </div>
      );
  }

  const { items, path, busy, pendingKey, nextKey, total, searchKey, loadingMore } = browse;
  const inSearch = path.at(-1)?.kind === "search";
  const disabled = busy || !online;
  const stale = browse.status === "loading";

  return (
    <div className="browse">
      <Breadcrumbs snapshot={snapshot} controller={controller} />
      {searchKey !== undefined && <SearchForm controller={controller} disabled={disabled} />}
      {items.length === 0 ? (
        <p className="muted" role="status">
          {t(stale ? "browse.loading" : inSearch ? "browse.noResults" : "browse.empty")}
        </p>
      ) : (
        <ul className={stale ? "browse-list is-stale" : "browse-list"} aria-busy={busy}>
          {items.map((item) => (
            <li key={item.key}>
              <Entry
                item={item}
                disabled={disabled}
                pending={pendingKey === item.key}
                onActivate={() =>
                  void (item.kind === "folder"
                    ? controller.browse.enter(item)
                    : controller.browse.play(item))
                }
              />
            </li>
          ))}
        </ul>
      )}
      {(nextKey !== undefined || total !== undefined) && (
        <div className="browse-footer">
          {total !== undefined && total > items.length && (
            <span className="hint">{t("browse.count", { shown: items.length, total })}</span>
          )}
          {nextKey !== undefined && (
            <button
              type="button"
              className="button button--ghost button--small"
              disabled={loadingMore || !online}
              onClick={() => void controller.browse.loadMore()}
            >
              {loadingMore ? t("browse.loadingMore") : t("browse.more")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function crumbLabel(crumb: BrowseCrumb, t: ReturnType<typeof useT>): string {
  return crumb.kind === "folder" ? crumb.name : t("browse.searchCrumb", { term: crumb.term });
}

function Breadcrumbs({ snapshot, controller }: Props) {
  const t = useT();
  const { path, busy } = snapshot.browse;
  const disabled = busy || snapshot.connection !== "online";
  const source = snapshot.modes.find((m) => m.key === snapshot.modeKey)?.label || t("browse.top");
  const labels = [source, ...path.map((c) => crumbLabel(c, t))];

  // Keyboard and screen reader users land on the new level's title after moving.
  const current = useRef<HTMLSpanElement>(null);
  const depth = path.length;
  const location = labels.join("\u0000");
  const previous = useRef(location);
  useEffect(() => {
    if (previous.current !== location) current.current?.focus();
    previous.current = location;
  }, [location]);

  return (
    <nav className="crumbs" aria-label={t("browse.path")}>
      {depth > 0 && (
        <IconButton
          icon="back"
          label={t("browse.back")}
          disabled={disabled}
          onClick={() => void controller.browse.back()}
        />
      )}
      <ol>
        {labels.map((label, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a crumb's identity is its depth
          <li key={index}>
            {index === depth ? (
              <span
                ref={current}
                className="crumb crumb--current"
                aria-current="location"
                tabIndex={-1}
              >
                {label}
              </span>
            ) : (
              <button
                type="button"
                className="crumb"
                disabled={disabled}
                onClick={() => void controller.browse.goTo(index)}
              >
                {label}
              </button>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

function SearchForm({ controller, disabled }: { controller: RadioController; disabled: boolean }) {
  const t = useT();
  const id = useId();
  const [term, setTerm] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    if (term.trim()) void controller.browse.search(term);
  }

  return (
    <search>
      <form className="search" onSubmit={submit}>
        <label className="visually-hidden" htmlFor={id}>
          {t("browse.search.label")}
        </label>
        <input
          id={id}
          type="search"
          value={term}
          placeholder={t("browse.search.placeholder")}
          enterKeyHint="search"
          autoComplete="off"
          onChange={(e) => setTerm(e.currentTarget.value)}
        />
        <button type="submit" className="button" disabled={disabled || !term.trim()}>
          <Icon name="search" size={20} />
          <span className="search__submit">{t("browse.search.submit")}</span>
        </button>
      </form>
    </search>
  );
}

function Entry({
  item,
  disabled,
  pending,
  onActivate,
}: {
  item: BrowseItem;
  disabled: boolean;
  pending: boolean;
  onActivate: () => void;
}) {
  const t = useT();
  const text = (
    <span className="browse-item__text">
      <span className="browse-item__name">{item.name}</span>
      {item.artist && <span className="browse-item__artist">{item.artist}</span>}
      {item.kind === "unsupported" && (
        <span className="browse-item__artist">{t("browse.unsupportedItem")}</span>
      )}
    </span>
  );

  if (item.kind !== "folder" && item.kind !== "playable") {
    return (
      <div className={`browse-item browse-item--static browse-item--${item.kind}`}>
        <span className="browse-item__art">
          <Icon name={item.kind === "error" ? "alert" : "radio"} size={20} />
        </span>
        {text}
      </div>
    );
  }

  const folder = item.kind === "folder";
  return (
    <button type="button" className="browse-item" disabled={disabled} onClick={onActivate}>
      <Thumb key={item.artworkUrl} url={item.artworkUrl} folder={folder} />
      {text}
      {folder && <span className="visually-hidden">{t("browse.folder")}</span>}
      {pending ? (
        <span className="spinner" role="status" aria-label={t("browse.working")} />
      ) : (
        folder && <Icon name="chevronRight" size={20} />
      )}
    </button>
  );
}

function Thumb({ url, folder }: { url: string; folder: boolean }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className="browse-item__art">
      {url && !failed ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          width={40}
          height={40}
          onError={() => setFailed(true)}
        />
      ) : (
        <Icon name={folder ? "folder" : "play"} size={20} />
      )}
    </span>
  );
}
