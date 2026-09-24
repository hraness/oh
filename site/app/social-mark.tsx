export const ohSocialTheme = {
  accent: "#486B58",
  background: "#F8F7F4",
  foreground: "#1C1A18",
  muted: "#6A655E",
} as const;

export function OhSocialMark() {
  return (
    <svg aria-label="Oh mark" fill="none" height="42" role="img" viewBox="0 0 42 42" width="42">
      <circle cx="10" cy="21" r="5" stroke="currentColor" strokeWidth="3" />
      <circle cx="32" cy="10" r="5" stroke="currentColor" strokeWidth="3" />
      <circle cx="32" cy="32" r="5" stroke="currentColor" strokeWidth="3" />
      <path d="m15 19 12-7M15 23l12 7" stroke="currentColor" strokeWidth="3" />
    </svg>
  );
}
