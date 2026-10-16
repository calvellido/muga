import type { ReactNode } from "react";

const filled = { fill: "currentColor", stroke: "none" } as const;

const PATHS = {
  play: (
    <path
      {...filled}
      d="M8 5.2v13.6c0 .8.9 1.3 1.6.8l10-6.8c.6-.4.6-1.2 0-1.6l-10-6.8C8.9 3.9 8 4.4 8 5.2z"
    />
  ),
  pause: (
    <>
      <rect {...filled} x="6" y="5" width="4.5" height="14" rx="1.2" />
      <rect {...filled} x="13.5" y="5" width="4.5" height="14" rx="1.2" />
    </>
  ),
  stop: <rect {...filled} x="6" y="6" width="12" height="12" rx="2" />,
  next: (
    <>
      <path
        {...filled}
        d="M5 6.6v10.8c0 .7.8 1.1 1.4.7l7.6-5.4c.5-.4.5-1.1 0-1.4L6.4 5.9C5.8 5.5 5 5.9 5 6.6z"
      />
      <rect {...filled} x="16" y="5.5" width="3" height="13" rx="1" />
    </>
  ),
  previous: (
    <>
      <path
        {...filled}
        d="M19 6.6v10.8c0 .7-.8 1.1-1.4.7L10 12.7c-.5-.4-.5-1.1 0-1.4l7.6-5.4c.6-.4 1.4 0 1.4.7z"
      />
      <rect {...filled} x="5" y="5.5" width="3" height="13" rx="1" />
    </>
  ),
  shuffle: (
    <>
      <path d="M3 7h3.2c2 0 3.2.9 4.2 2.6l3.2 4.8c1 1.7 2.2 2.6 4.2 2.6H21" />
      <path d="M3 17h3.2c1.3 0 2.3-.4 3.1-1.2M14.7 8.2c.8-.8 1.8-1.2 3.1-1.2H21" />
      <path d="M18 4l3 3-3 3M18 14l3 3-3 3" />
    </>
  ),
  repeat: (
    <>
      <path d="M17 3l3 3-3 3" />
      <path d="M4 11.5V10a4 4 0 0 1 4-4h12" />
      <path d="M7 21l-3-3 3-3" />
      <path d="M20 12.5V14a4 4 0 0 1-4 4H4" />
    </>
  ),
  repeatOne: (
    <>
      <path d="M17 3l3 3-3 3" />
      <path d="M4 11.5V10a4 4 0 0 1 4-4h12" />
      <path d="M7 21l-3-3 3-3" />
      <path d="M20 12.5V14a4 4 0 0 1-4 4H4" />
      <path d="M11 10.5l1.5-1v5" strokeWidth="1.8" />
    </>
  ),
  volume: (
    <>
      <path d="M4 9.5h3l4.5-4v13L7 14.5H4z" />
      <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.5 6.2a8.2 8.2 0 0 1 0 11.6" />
    </>
  ),
  muted: (
    <>
      <path d="M4 9.5h3l4.5-4v13L7 14.5H4z" />
      <path d="M16 9.5l5 5M21 9.5l-5 5" />
    </>
  ),
  power: (
    <>
      <path d="M12 3.5v8" />
      <path d="M6.6 7.2a7.5 7.5 0 1 0 10.8 0" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  settings: (
    <>
      <path d="M4 7h8.5M17.5 7H20M4 17h2.5M11.5 17H20" />
      <circle cx="15" cy="7" r="2.5" />
      <circle cx="9" cy="17" r="2.5" />
    </>
  ),
  gear: (
    <>
      <path d="M10.38 4.98L10.66 2.49H13.34L13.62 4.98L15.82 5.89L17.78 4.33L19.67 6.22L18.11 8.18L19.02 10.38L21.51 10.66V13.34L19.02 13.62L18.11 15.82L19.67 17.78L17.78 19.67L15.82 18.11L13.62 19.02L13.34 21.51H10.66L10.38 19.02L8.18 18.11L6.22 19.67L4.33 17.78L5.89 15.82L4.98 13.62L2.49 13.34V10.66L4.98 10.38L5.89 8.18L4.33 6.22L6.22 4.33L8.18 5.89Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  chevronDown: <path d="M6 9l6 6 6-6" />,
  chevronRight: <path d="M9.5 6l6 6-6 6" />,
  back: <path d="M19 12H5.5M11 6l-6 6 6 6" />,
  arrowUp: <path d="M12 19V5.5M6 11l6-6 6 6" />,
  arrowDown: <path d="M12 5v13.5M6 13l6 6 6-6" />,
  folder: (
    <path d="M3.5 7.5a2 2 0 0 1 2-2h3.7c.6 0 1.1.3 1.5.7l1.3 1.8h6.5a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M15 15l5 5" />
    </>
  ),
  save: (
    <>
      <path d="M7 3.5h10a1 1 0 0 1 1 1V20l-6-4-6 4V4.5a1 1 0 0 1 1-1z" />
      <path d="M12 7.5v5M9.5 10h5" />
    </>
  ),
  radio: (
    <>
      <rect x="3" y="8" width="18" height="12.5" rx="2.5" />
      <circle cx="9" cy="14.25" r="3" />
      <path d="M15 12.5h3M15 16h3M7.5 8l9-4.5" />
    </>
  ),
  group: (
    <>
      <rect x="3" y="6.5" width="10.5" height="14" rx="2.2" />
      <circle cx="8.25" cy="14.75" r="2.6" />
      <path d="M8.25 10h.01" />
      <path d="M16.5 6.5h2.3a2.2 2.2 0 0 1 2.2 2.2v9.6a2.2 2.2 0 0 1-2.2 2.2h-2.3" />
      <path d="M7 3.5h8.3a2.2 2.2 0 0 1 2.2 2.2" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5M12 16.5v.01" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9.5" rx="2" />
      <path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3" />
    </>
  ),
  trash: (
    <path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l.9 12.2c.1.9.8 1.6 1.7 1.6h5.8c.9 0 1.6-.7 1.7-1.6L17.5 7M9.5 7V4.5h5V7" />
  ),
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof PATHS;

/** Icons that point along the reading direction; mirrored in right-to-left layouts. */
const DIRECTIONAL = new Set<IconName>(["chevronRight", "back"]);

export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  return (
    <svg
      className={DIRECTIONAL.has(name) ? "icon icon--directional" : "icon"}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
