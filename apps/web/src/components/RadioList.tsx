import { useT } from "../i18n/index.tsx";
import { useRadio, useRegistry, useRegistrySnapshot } from "../radio/hooks.ts";
import { statusLine } from "./status.ts";

export function RadioList({ onSelect }: { onSelect?: () => void }) {
  const registry = useRegistry();
  const { radios, activeId } = useRegistrySnapshot();
  return (
    <ul className="radio-list">
      {radios.map((radio) => (
        <RadioListItem
          key={radio.id}
          id={radio.id}
          active={radio.id === activeId}
          onSelect={() => {
            registry.select(radio.id);
            onSelect?.();
          }}
        />
      ))}
    </ul>
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
