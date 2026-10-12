import { useId } from "react";

/** The Cash Cow mascot, drawn after the brand reference: round white head, charcoal spots, pink snout. */
const OUT = "#1E1E1E";
const SPOT = "#4A4A4A";
const NOSE = "#F4A9BC";

export function Cow({ size = 40, full = false, className = "" }: { size?: number; full?: boolean; className?: string }) {
  const uid = useId().replace(/:/g, "");
  const headId = `${uid}-head`;
  const bodyId = `${uid}-body`;
  const h = full ? 240 : 170;
  return (
    <svg
      viewBox={`0 0 220 ${h}`}
      width={size}
      height={(size * h) / 220}
      className={className}
      role="img"
      aria-label="Cash Cow"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <defs>
        <clipPath id={headId}>
          <ellipse cx="110" cy="92" rx="72" ry="66" />
        </clipPath>
        {full && (
          <clipPath id={bodyId}>
            <ellipse cx="110" cy="168" rx="92" ry="62" />
          </clipPath>
        )}
      </defs>

      {full && (
        <g>
          {/* Hooves */}
          <rect x="52" y="200" width="44" height="34" rx="16" fill={SPOT} stroke={OUT} strokeWidth="5" />
          <rect x="124" y="200" width="44" height="34" rx="16" fill={SPOT} stroke={OUT} strokeWidth="5" />
          <path d="M74 214v18M146 214v18" stroke={OUT} strokeWidth="4" />
          {/* Body */}
          <ellipse cx="110" cy="168" rx="92" ry="62" fill="#fff" />
          <g clipPath={`url(#${bodyId})`} fill={SPOT}>
            <path d="M14 150c18-8 34 4 30 24s-22 30-34 22z" />
            <path d="M176 140c16-6 30 10 26 32s-16 32-30 28-14-22-10-38 6-20 14-22z" />
            <path d="M92 196c14-8 34-2 36 12s-16 26-30 22-18-26-6-34z" />
          </g>
          <ellipse cx="110" cy="168" rx="92" ry="62" fill="none" stroke={OUT} strokeWidth="6" />
        </g>
      )}

      {/* Horns */}
      <path d="M58 40c-8-14-6-28 4-34 4 10 14 18 26 22z" fill={SPOT} stroke={OUT} strokeWidth="5" />
      <path d="M162 40c8-14 6-28-4-34-4 10-14 18-26 22z" fill={SPOT} stroke={OUT} strokeWidth="5" />
      {/* Ears */}
      <path d="M48 70C30 62 10 66 4 78c14 12 34 16 52 10z" fill="#fff" stroke={OUT} strokeWidth="5" />
      <path d="M172 70c18-8 38-4 44 8-14 12-34 16-52 10z" fill="#fff" stroke={OUT} strokeWidth="5" />

      {/* Head with clipped spots */}
      <ellipse cx="110" cy="92" rx="72" ry="66" fill="#fff" />
      <g clipPath={`url(#${headId})`} fill={SPOT}>
        <path d="M132 22c20-4 40 10 40 26s-18 20-30 14-24-12-22-22 4-16 12-18z" />
        <path d="M36 112c14-6 26 4 24 18s-14 22-26 16z" />
      </g>
      <ellipse cx="110" cy="92" rx="72" ry="66" fill="none" stroke={OUT} strokeWidth="6" />

      {/* Eyes */}
      <ellipse cx="86" cy="70" rx="18" ry="20" fill="#fff" stroke={OUT} strokeWidth="5" />
      <ellipse cx="134" cy="70" rx="18" ry="20" fill="#fff" stroke={OUT} strokeWidth="5" />
      <circle cx="92" cy="74" r="7" fill={OUT} />
      <circle cx="128" cy="74" r="7" fill={OUT} />

      {/* Snout */}
      <ellipse cx="110" cy="122" rx="36" ry="26" fill={NOSE} stroke={OUT} strokeWidth="5" />
      <ellipse cx="97" cy="122" rx="5" ry="8" fill={OUT} transform="rotate(-12 97 122)" />
      <ellipse cx="123" cy="122" rx="5" ry="8" fill={OUT} transform="rotate(12 123 122)" />
    </svg>
  );
}
