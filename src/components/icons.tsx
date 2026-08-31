interface IconProps {
  size?: number;
  className?: string;
  strokeWidth?: number;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  xmlns: 'http://www.w3.org/2000/svg',
});

export function ArrowLeft({ size = 20, strokeWidth = 2.2 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path
        d="M15 5l-7 7 7 7"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Calendar({ size = 19 }: IconProps) {
  return (
    <svg {...base(size)}>
      <rect
        x="3.2"
        y="4.8"
        width="17.6"
        height="15.4"
        rx="3"
        stroke="currentColor"
        strokeWidth="1.9"
      />
      <path
        d="M3.4 9.4h17.2M8.2 3.2v3.4M15.8 3.2v3.4"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Star({ size = 19, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path
        d="M12 3.6l2.6 5.3 5.8.85-4.2 4.1 1 5.75L12 16.9l-5.2 2.7 1-5.75-4.2-4.1 5.8-.85z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        fill="currentColor"
        fillOpacity="var(--star-fill, 0)"
      />
    </svg>
  );
}

export function Share({ size = 19 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path
        d="M12 15.4V3.8M12 3.8L8.2 7.6M12 3.8l3.8 3.8"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.2 12.6v5.8a2 2 0 002 2h9.6a2 2 0 002-2v-5.8"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Chat({ size = 19 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path
        d="M20.4 11.4c0 4.1-3.8 7.4-8.4 7.4-1 0-2-.15-2.9-.44L4.2 20l1.3-3.5C4.2 15.2 3.6 13.4 3.6 11.4c0-4.1 3.8-7.4 8.4-7.4s8.4 3.3 8.4 7.4z"
        stroke="currentColor"
        strokeWidth="1.85"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Info({ size = 21 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="9.1" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M12 10.9v5.4"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
      />
      <circle cx="12" cy="7.9" r="1.15" fill="currentColor" />
    </svg>
  );
}

export function Book({ size = 21 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path
        d="M12 6.4C10.6 5.2 8.7 4.6 6 4.6H3.4v13.2H6c2.7 0 4.6.6 6 1.8 1.4-1.2 3.3-1.8 6-1.8h2.6V4.6H18c-2.7 0-4.6.6-6 1.8z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M12 6.4v13.2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function ArrowUp({ size = 16, strokeWidth = 2.6 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path
        d="M12 19.5V5M12 5l-6 6M12 5l6 6"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ArrowDown({ size = 16, strokeWidth = 2.6 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path
        d="M12 4.5V19M12 19l6-6M12 19l-6-6"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Close({ size = 15 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path
        d="M5.5 5.5l13 13M18.5 5.5l-13 13"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Gear({ size = 19 }: IconProps) {
  return (
    <svg {...base(size)}>
      <circle cx="12" cy="12" r="3.1" stroke="currentColor" strokeWidth="1.85" />
      <path
        d="M19.3 14.6a1.6 1.6 0 00.32 1.77l.06.06a1.95 1.95 0 11-2.76 2.76l-.06-.06a1.6 1.6 0 00-1.77-.32 1.6 1.6 0 00-.97 1.47v.16a1.95 1.95 0 11-3.9 0v-.09a1.6 1.6 0 00-1.05-1.46 1.6 1.6 0 00-1.77.32l-.06.06A1.95 1.95 0 114.58 16.5l.06-.06a1.6 1.6 0 00.32-1.77 1.6 1.6 0 00-1.47-.97h-.16a1.95 1.95 0 110-3.9h.09a1.6 1.6 0 001.46-1.05 1.6 1.6 0 00-.32-1.77l-.06-.06A1.95 1.95 0 117.26 4.2l.06.06a1.6 1.6 0 001.77.32h.08A1.6 1.6 0 0010.15 3.1v-.16a1.95 1.95 0 113.9 0v.09a1.6 1.6 0 00.97 1.47 1.6 1.6 0 001.77-.32l.06-.06a1.95 1.95 0 112.76 2.76l-.06.06a1.6 1.6 0 00-.32 1.77v.08a1.6 1.6 0 001.47.98h.16a1.95 1.95 0 110 3.9h-.09a1.6 1.6 0 00-1.47.97z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Receipt({ size = 19 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path
        d="M5.2 3.4l1.6 1.4 1.7-1.4 1.7 1.4 1.8-1.4 1.7 1.4 1.7-1.4 1.6 1.4 1.6-1.4v17.2l-1.6-1.4-1.6 1.4-1.7-1.4-1.7 1.4-1.8-1.4-1.7 1.4-1.7-1.4-1.6 1.4z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M8.4 9.6h7.2M8.4 13.8h4.6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Check({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path
        d="M5 12.8l4.4 4.2L19 6.6"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Cross({ size = 16 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path
        d="M6.4 6.4l11.2 11.2M17.6 6.4L6.4 17.6"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Backspace({ size = 20 }: IconProps) {
  return (
    <svg {...base(size)}>
      <path
        d="M8.4 5.4h11a1.8 1.8 0 011.8 1.8v9.6a1.8 1.8 0 01-1.8 1.8h-11L2.8 12z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M11.6 9.6l5 4.8M16.6 9.6l-5 4.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The combo mark — a diamond outline with a small inner diamond. */
export function ComboMark({ size = 20 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <defs>
        <linearGradient id="combo-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#7b8cff" />
          <stop offset="55%" stopColor="#b06bff" />
          <stop offset="100%" stopColor="#ff8ac4" />
        </linearGradient>
      </defs>
      <rect
        x="12"
        y="1.6"
        width="14.7"
        height="14.7"
        rx="3"
        transform="rotate(45 12 1.6)"
        stroke="url(#combo-grad)"
        strokeWidth="1.9"
      />
      <rect
        x="12"
        y="7.6"
        width="6.2"
        height="6.2"
        rx="1.2"
        transform="rotate(45 12 7.6)"
        fill="url(#combo-grad)"
      />
    </svg>
  );
}

/** Bitcoin ₿ for live mode. */
export function BitcoinGlyph({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M9.6 4.4v15.2M13 3.2v2.1M13 18.7v2.1M9.6 5.6h4.9a3.15 3.15 0 010 6.3H9.6zM9.6 11.9h5.6a3.35 3.35 0 010 6.7H9.6M6.9 5.6h2.7M6.9 18.6h2.7"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The JIT mark — a bolt, because the sim never sleeps. */
export function JitGlyph({ size = 24 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M13.6 2.6L5.4 13.4h5.3l-1.1 8 8.4-11h-5.4z"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Status-bar cellular / wifi / battery cluster. */
export function StatusGlyphs() {
  return (
    <>
      <svg width="18" height="12" viewBox="0 0 18 12" fill="none">
        <rect x="0" y="8" width="3" height="4" rx="1" fill="currentColor" />
        <rect x="5" y="5.5" width="3" height="6.5" rx="1" fill="currentColor" />
        <rect x="10" y="3" width="3" height="9" rx="1" fill="currentColor" />
        <rect x="15" y="0.5" width="3" height="11.5" rx="1" fill="currentColor" />
      </svg>
      <svg width="16" height="12" viewBox="0 0 16 12" fill="none">
        <path
          d="M1 4.3a10.4 10.4 0 0114 0"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
        <path
          d="M3.7 7.2a6.5 6.5 0 018.6 0"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
        />
        <circle cx="8" cy="10.2" r="1.4" fill="currentColor" />
      </svg>
      <svg width="26" height="13" viewBox="0 0 26 13" fill="none">
        <rect
          x="0.7"
          y="0.7"
          width="22"
          height="11.6"
          rx="3.4"
          stroke="currentColor"
          strokeOpacity="0.42"
          strokeWidth="1.2"
        />
        <rect x="2.5" y="2.5" width="17" height="8" rx="2.1" fill="currentColor" />
        <path
          d="M24.4 4.6v3.8c.9-.35 1.3-1 1.3-1.9s-.4-1.55-1.3-1.9z"
          fill="currentColor"
          fillOpacity="0.42"
        />
      </svg>
    </>
  );
}
