import { Icon, type IconName } from "./Icon.tsx";

interface IconButtonProps {
  icon: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  /** Keeps its place in the layout but is invisible and unfocusable. */
  hidden?: boolean;
  className?: string;
  size?: number;
}

export function IconButton({
  icon,
  label,
  onClick,
  disabled,
  pressed,
  hidden,
  className,
  size = 24,
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={["icon-button", className, hidden ? "is-hidden" : ""].filter(Boolean).join(" ")}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled || hidden}
      onClick={onClick}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}
