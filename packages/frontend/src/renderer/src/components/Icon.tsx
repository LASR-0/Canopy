/**
 * All Canopy icons — lifted from the prototype's inline SVG set.
 * 16px viewBox. Two internal flavours: stroked (fill="none") and filled.
 * Add new icons here as the design evolves; keep them alphabetical within groups.
 */

export type IconName =
  // ── navigation ──────────────────────────────────────────────────────────
  | "archive"
  | "automation"
  | "cycle"
  | "journal"
  | "logging"
  | "maintenance"
  | "overview"
  | "settings"
  | "setup"
  // ── ui / actions ────────────────────────────────────────────────────────
  | "alert"
  | "arrow-down"
  | "bluetooth"
  | "arrow-right"
  | "arrow-up"
  | "beaker"
  | "bell"
  | "camera"
  | "check"
  | "chevron"
  | "clock"
  | "dots"
  | "external"
  | "eye"
  | "fan"
  | "gear"
  | "info"
  | "leaf"
  | "lock"
  | "minus"
  | "pin"
  | "plug"
  | "plus"
  | "power"
  | "radar"
  | "refresh"
  | "ruler"
  | "scissors"
  | "search"
  | "slider"
  | "star"
  | "target"
  | "trash"
  | "wifi"
  | "x"
  // ── metrics ─────────────────────────────────────────────────────────────
  | "co2"
  | "drop"
  | "seedling"
  | "sun"
  | "temp"
  | "vpd";

interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
}

export function Icon({ name, size = 16, className }: IconProps) {
  /** Stroked wrapper */
  const S = (sw: number, children: React.ReactNode) => (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
  /** Filled wrapper */
  const F = (children: React.ReactNode) => (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="currentColor"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );

  switch (name) {
    // ── navigation ─────────────────────────────────────────────────────────
    case "overview":
      return S(1.5, <>
        <rect x="1.75" y="1.75" width="5" height="5" rx="1"/>
        <rect x="9.25" y="1.75" width="5" height="5" rx="1"/>
        <rect x="1.75" y="9.25" width="5" height="5" rx="1"/>
        <rect x="9.25" y="9.25" width="5" height="5" rx="1"/>
      </>);
    case "automation":
      return F(<path d="M8.4 1 3 8.6c-.2.3 0 .7.4.7h3.1l-.8 5.1c-.1.5.5.8.8.4L12 7.2c.2-.3 0-.7-.4-.7H8.7l.5-5.1c.1-.5-.5-.8-.8-.4Z"/>);
    case "cycle":
      return S(1.5, <>
        <path d="M2.6 8a5.4 5.4 0 0 1 9.1-3.9"/>
        <path d="M11.7 1.9v2.6H9.1"/>
        <path d="M13.4 8a5.4 5.4 0 0 1-9.1 3.9"/>
        <path d="M4.3 14.1v-2.6h2.6"/>
      </>);
    case "journal":
      return S(1.5, <>
        <path d="M2.25 2.5A1.25 1.25 0 0 1 3.5 1.25h9.25v11H3.5a1.25 1.25 0 0 0-1.25 1.25Z"/>
        <path d="M2.25 13.5A1.25 1.25 0 0 1 3.5 12.25h9.25v2.5H3.5a1.25 1.25 0 0 1-1.25-1.25Z"/>
        <path d="M5 4.25h5M5 6.5h5"/>
      </>);
    case "maintenance":
      return S(1.5, <>
        <circle cx="8" cy="8" r="2.4"/>
        <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1"/>
      </>);
    case "logging":
      return S(1.5, <>
        <path d="M1.75 14.25V1.75"/>
        <path d="M1.75 14.25H14.5"/>
        <rect x="3.75" y="8" width="2.2" height="4.5"/>
        <rect x="7.4" y="5" width="2.2" height="7.5"/>
        <rect x="11.05" y="3" width="2.2" height="9.5"/>
      </>);
    case "setup":
      return S(1.5, <>
        <circle cx="5.25" cy="4.5" r="1.6"/>
        <path d="M1.75 4.5h1.9M6.85 4.5h7.4"/>
        <circle cx="10.75" cy="11.5" r="1.6"/>
        <path d="M1.75 11.5h7.4M12.35 11.5h1.9"/>
      </>);

    // ── ui / actions ───────────────────────────────────────────────────────
    case "archive":
      return S(1.5, <>
        <path d="M2 5h12v8.25a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1Z"/>
        <rect x="1.5" y="2.5" width="13" height="2.5" rx="0.75"/>
        <path d="M8 7v3.5M6 9.25l2 1.5 2-1.5"/>
      </>);
    case "search":
      return S(1.6, <>
        <circle cx="6.75" cy="6.75" r="4.75"/>
        <path d="m10.5 10.5 3 3"/>
      </>);
    case "bell":
      return S(1.5, <>
        <path d="M8 1.6a3.6 3.6 0 0 0-3.6 3.6c0 3.2-1.1 4.3-1.1 4.3h9.4s-1.1-1.1-1.1-4.3A3.6 3.6 0 0 0 8 1.6Z"/>
        <path d="M6.7 12.4a1.4 1.4 0 0 0 2.6 0"/>
      </>);
    case "bluetooth":
      return S(1.5, <>
        <path d="M7 2v12M7 2l4 3-4 3M7 8l4 3-4 3" />
      </>);
    case "refresh":
      return S(1.6, <>
        <path d="M13.3 7A5.3 5.3 0 1 0 12 11"/>
        <path d="M13.4 3.4V7H9.8"/>
      </>);
    case "plus":
      return S(1.8, <path d="M8 3v10M3 8h10"/>);
    case "minus":
      return S(1.8, <path d="M3 8h10"/>);
    case "x":
      return S(1.7, <path d="M4 4 12 12M12 4 4 12"/>);
    case "check":
      return S(1.8, <path d="m3.5 8.5 2.8 2.8L12.5 5"/>);
    case "leaf":
      return F(<path d="M13.5 2.5C8 2 3 4.5 3 9.5c0 1 .2 1.9.6 2.7L2 13.8l.9.9 1.6-1.6c.8.4 1.7.6 2.7.6 5 0 7.5-5 7-10.5-.1-.4-.3-.6-.7-.7ZM6.5 10.5C7.7 8 9.6 6.6 11.5 6c-1.5 1.3-3 3.2-4 5.5-.3-.3-.7-.7-1-1Z"/>);
    case "chevron":
      return S(1.6, <path d="m4.5 6 3.5 3.5L11.5 6"/>);
    case "gear":
    case "settings":
      return S(1.5, <>
        <circle cx="8" cy="8" r="2"/>
        <path d="M8 1.6v1.4M8 13v1.4M2.1 4.5l1.2.7M12.7 10.8l1.2.7M2.1 11.5l1.2-.7M12.7 5.2l1.2-.7"/>
      </>);
    case "dots":
      return F(<>
        <circle cx="3" cy="8" r="1.3"/>
        <circle cx="8" cy="8" r="1.3"/>
        <circle cx="13" cy="8" r="1.3"/>
      </>);
    case "external":
      return S(1.4, <>
        <path d="M6 3.5H3.5v9h9V10"/>
        <path d="M9.5 3.5h3v3M12 4 7 9"/>
      </>);
    case "wifi":
      return S(1.5, <>
        <path d="M1.8 5.4a9 9 0 0 1 12.4 0"/>
        <path d="M4.1 8.1a5.6 5.6 0 0 1 7.8 0"/>
        <path d="M6.3 10.7a2.4 2.4 0 0 1 3.4 0"/>
        <circle cx="8" cy="13" r="0.7" fill="currentColor" stroke="none"/>
      </>);
    case "radar":
      return S(1.5, <>
        <circle cx="8" cy="8" r="6.2"/>
        <circle cx="8" cy="8" r="3"/>
        <path d="M8 8 12.4 3.6"/>
        <circle cx="8" cy="8" r="0.8" fill="currentColor" stroke="none"/>
      </>);
    case "plug":
      return S(1.5, <>
        <path d="M5.2 2.4v3M10.8 2.4v3"/>
        <path d="M3.6 5.4h8.8v1.9a4.4 4.4 0 0 1-8.8 0Z"/>
        <path d="M8 11.7v2.1"/>
      </>);
    case "slider":
      return S(1.5, <>
        <path d="M2.5 5.5h2M7.6 5.5h5.9"/>
        <circle cx="6" cy="5.5" r="1.6"/>
        <path d="M2.5 10.5h5.9M11.6 10.5h1.9"/>
        <circle cx="10" cy="10.5" r="1.6"/>
      </>);
    case "target":
      return S(1.5, <>
        <circle cx="8" cy="8" r="6"/>
        <circle cx="8" cy="8" r="2.4"/>
      </>);
    case "trash":
      return S(1.5, <>
        <path d="M2.75 4.25h10.5M6 4.25V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.25"/>
        <path d="M4.4 4.25l.65 8.35a1 1 0 0 0 1 .9h3.9a1 1 0 0 0 1-.9l.65-8.35"/>
      </>);
    case "lock":
      return S(1.5, <>
        <rect x="3.25" y="7" width="9.5" height="6.25" rx="1.4"/>
        <path d="M5.4 7V4.9a2.6 2.6 0 0 1 5.2 0V7"/>
      </>);
    case "arrow-right":
      return S(1.6, <>
        <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5"/>
      </>);
    case "arrow-up":
      return S(1.8, <>
        <path d="M8 12V4M4.5 7.5 8 4l3.5 3.5"/>
      </>);
    case "arrow-down":
      return S(1.8, <>
        <path d="M8 4v8M11.5 8.5 8 12 4.5 8.5"/>
      </>);
    case "star":
      return F(<path d="M8 1.6l1.8 3.9 4.2.5-3.1 2.9.8 4.2L8 11.9 4.3 13.1l.8-4.2L2 6l4.2-.5z"/>);
    case "pin":
      return S(1.4, <>
        <path d="M6 2h4l-.5 3 2 2v1H4.5V7l2-2z"/>
        <path d="M8 8v6"/>
      </>);
    case "camera":
      return S(1.4, <>
        <path d="M2.25 5.5h2.1l.9-1.5h5.5l.9 1.5h2.1v7.25H2.25z"/>
        <circle cx="8" cy="9" r="2.1"/>
      </>);
    case "scissors":
      return S(1.4, <>
        <circle cx="4" cy="4.2" r="1.7"/>
        <circle cx="4" cy="11.8" r="1.7"/>
        <path d="M5.4 5.3 13 11.5M5.4 10.7 13 4.5"/>
      </>);
    case "eye":
      return S(1.4, <>
        <path d="M1.5 8S4 3.6 8 3.6 14.5 8 14.5 8 12 12.4 8 12.4 1.5 8 1.5 8Z"/>
        <circle cx="8" cy="8" r="1.9"/>
      </>);
    case "ruler":
      return S(1.4, <>
        <rect x="2" y="5.25" width="12" height="5.5" rx="1"/>
        <path d="M5 5.25v2M8 5.25v2.6M11 5.25v2"/>
      </>);
    case "alert":
      return S(1.5, <>
        <path d="M7 2.4 1.6 12a1 1 0 0 0 .9 1.5h11a1 1 0 0 0 .9-1.5L9 2.4a1.15 1.15 0 0 0-2 0Z"/>
        <path d="M8 6.2v3M8 11.2h.01"/>
      </>);
    case "clock":
      return S(1.5, <>
        <circle cx="8" cy="8" r="6.2"/>
        <path d="M8 4.5V8l2.4 1.4"/>
      </>);
    case "info":
      return S(1.5, <>
        <circle cx="8" cy="8" r="6.2"/>
        <path d="M8 7.3v3.4M8 5.2h.01"/>
      </>);
    case "power":
      return S(1.5, <>
        <path d="M8 1.8v5.4"/>
        <path d="M4.6 4.2a4.8 4.8 0 1 0 6.8 0"/>
      </>);
    case "fan":
      return S(1.4, <>
        <circle cx="8" cy="8" r="1.3"/>
        <path d="M8 6.7C8 4 9 2 10.5 2.5S11 6 8 6.7Z"/>
        <path d="M9.3 8C12 8 14 9 13.5 10.5S10 11 9.3 8Z"/>
        <path d="M8 9.3C8 12 7 14 5.5 13.5S5 10 8 9.3Z"/>
        <path d="M6.7 8C4 8 2 7 2.5 5.5S6 5 6.7 8Z"/>
      </>);

    // ── metrics ────────────────────────────────────────────────────────────
    case "temp":
      return S(1.5, <>
        <path d="M6 8.5V3.2a2 2 0 1 1 4 0V8.5a3 3 0 1 1-4 0Z"/>
        <path d="M8 7v3.6"/>
      </>);
    case "drop":
      return S(1.5, <path d="M8 1.8s4 4.2 4 7.1a4 4 0 1 1-8 0c0-2.9 4-7.1 4-7.1Z"/>);
    case "vpd":
      return S(1.4, <>
        <path d="M2 11s1.5-2 3-2 1.5 2 3 2 1.5-2 3-2 3 2 3 2"/>
        <path d="M2 6.5s1.5-2 3-2 1.5 2 3 2 1.5-2 3-2 3 2 3 2"/>
      </>);
    case "co2":
      return F(<>
        <path d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2Zm0 1.5A4.5 4.5 0 1 1 8 12.5 4.5 4.5 0 0 1 8 3.5Z"/>
        <circle cx="8" cy="8" r="2"/>
      </>);
    case "sun":
      return S(1.5, <>
        <circle cx="8" cy="8" r="2.6"/>
        <path d="M8 1.5v1.4M8 13.1v1.4M1.5 8h1.4M13.1 8h1.4M3.3 3.3l1 1M11.7 11.7l1 1M12.7 3.3l-1 1M4.3 11.7l-1 1"/>
      </>);
    case "seedling":
      return S(1.5, <>
        <path d="M8 14V7"/>
        <path d="M8 8.5C8 6 6 4.5 3.5 4.5 3.5 7 5.5 8.5 8 8.5Z"/>
        <path d="M8 7.5C8 5.4 9.7 4 11.8 4c0 2.1-1.7 3.5-3.8 3.5Z"/>
      </>);
    case "beaker":
      return S(1.5, <>
        <path d="M6 1.75v3.9L2.9 11.4A1.4 1.4 0 0 0 4.1 13.5h7.8a1.4 1.4 0 0 0 1.2-2.1L10 5.65v-3.9"/>
        <path d="M5.3 1.75h5.4M4.6 8.5h6.8"/>
      </>);
  }
}
