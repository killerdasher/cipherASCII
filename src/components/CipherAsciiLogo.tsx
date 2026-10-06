interface CipherAsciiLogoProps {
  size?: number;
  className?: string;
  title?: string;
}

/**
 * cipherASCII brand mark: an abstract geometric eye framed by data brackets,
 * with a faceted rune as the pupil. Pure SVG so it scales from a 16px
 * favicon to a full-screen splash, and it inherits the active theme through
 * currentColor / the app's CSS variables.
 */
export function CipherAsciiLogo({ size = 32, className, title = 'cipherASCII' }: CipherAsciiLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={title}
      className={className}
      style={{ filter: 'drop-shadow(0 0 6px var(--glow, transparent))' }}
    >
      {/* data brackets */}
      <path
        d="M20 8 H8 V56 H20"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="3"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />
      <path
        d="M44 8 H56 V56 H44"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="3"
        strokeLinecap="square"
        strokeLinejoin="miter"
      />

      {/* packet dots on the brackets */}
      <g fill="var(--fg)">
        <rect x="10.5" y="18" width="3" height="3" />
        <rect x="10.5" y="30.5" width="3" height="3" />
        <rect x="10.5" y="43" width="3" height="3" />
        <rect x="50.5" y="18" width="3" height="3" />
        <rect x="50.5" y="30.5" width="3" height="3" />
        <rect x="50.5" y="43" width="3" height="3" />
      </g>

      {/* eye */}
      <path
        d="M16 32 C23 21, 41 21, 48 32 C41 43, 23 43, 16 32 Z"
        fill="none"
        stroke="var(--fg)"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />

      {/* iris rings */}
      <circle cx="32" cy="32" r="9.5" fill="none" stroke="var(--accent)" strokeWidth="2" />
      <circle cx="32" cy="32" r="13" fill="none" stroke="var(--fg-muted, var(--fg))" strokeWidth="1" opacity="0.55" />

      {/* rune pupil */}
      <path d="M32 25 L39 32 L32 39 L25 32 Z" fill="var(--accent)" />
      <path d="M32 28.5 L35.5 32 L32 35.5 L28.5 32 Z" fill="var(--bg)" />

      {/* highlight */}
      <circle cx="29" cy="29" r="1.6" fill="var(--fg)" opacity="0.9" />
    </svg>
  );
}

export default CipherAsciiLogo;
