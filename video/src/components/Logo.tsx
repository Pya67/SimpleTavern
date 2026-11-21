import { colors } from "../theme";

/** The SimpleTavern tankard (src/components/app/logo.tsx), with the beer in the Blue accent. */
export const LogoMark = ({ size }: { size: number }) => (
  <svg viewBox="0 0 512 512" width={size} height={size} style={{ display: "block" }}>
    <rect width="512" height="512" rx="112" fill="oklch(0.22 0.012 250)" />
    <g transform="rotate(-12 256 270) translate(-16 4)">
      <path d="M330 236H352A44 44 0 0 1 396 280V300A44 44 0 0 1 352 344H330" fill="none" stroke={colors.brand} strokeWidth="32" />
      <rect x="134" y="200" width="200" height="212" rx="28" fill={colors.brand} />
      <path
        d="M134 230V208C134 182 152 164 176 162C186 138 210 124 236 124C262 124 282 138 292 158C316 158 334 178 334 202V230Z"
        fill="#EEF0F6"
      />
      <path d="M266 228V262A14 14 0 0 0 294 262V228Z" fill="#EEF0F6" />
    </g>
    <circle cx="348" cy="106" r="16" fill="#EEF0F6" />
    <circle cx="390" cy="138" r="10" fill="#EEF0F6" />
  </svg>
);
