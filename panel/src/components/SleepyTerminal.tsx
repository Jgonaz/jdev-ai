/**
 * Ilustración de los estados vacíos: una terminal dormida con «z Z» flotando.
 * Hereda el color del texto (`currentColor`); las zetas van en el acento y su
 * animación se apaga con prefers-reduced-motion (base.css).
 */
export function SleepyTerminal({ size = 72, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      className={`sleepy ${className}`.trim()}
      width={size}
      height={(size * 52) / 72}
      viewBox="0 0 72 52"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="4" y="12" width="46" height="36" rx="6" />
      <path d="M4 21h46" />
      <g fill="currentColor" stroke="none">
        <circle cx="10.5" cy="16.5" r="1.3" />
        <circle cx="15" cy="16.5" r="1.3" />
        <circle cx="19.5" cy="16.5" r="1.3" />
      </g>
      {/* Ojos cerrados y boca. */}
      <path d="M15 31q3.5 3.5 7 0M32 31q3.5 3.5 7 0M24.5 40h5" />
      <path className="sleepy__z" d="M54 15h5l-5 6h5" strokeWidth={1.8} />
      <path className="sleepy__z sleepy__z--big" d="M60 2h8l-8 9h8" strokeWidth={2} />
    </svg>
  );
}
