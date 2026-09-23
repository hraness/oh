import {
  createSocialImageResponse,
  socialImageContentType as contentType,
  socialImageSize as size,
} from "@hraness/web-discovery/social-image";

export const alt = "Oh: a research graph your agents can inspect";
export { contentType, size };

function OhMark() {
  return (
    <svg aria-label="Oh mark" fill="none" height="42" role="img" viewBox="0 0 42 42" width="42">
      <circle cx="10" cy="21" r="5" stroke="currentColor" strokeWidth="3" />
      <circle cx="32" cy="10" r="5" stroke="currentColor" strokeWidth="3" />
      <circle cx="32" cy="32" r="5" stroke="currentColor" strokeWidth="3" />
      <path d="m15 19 12-7M15 23l12 7" stroke="currentColor" strokeWidth="3" />
    </svg>
  );
}

export default function OpenGraphImage() {
  return createSocialImageResponse({
    description: "Oh gives your agents a local path from a question to a cited artifact: sources, claims, citations, and a verifiable history of every change, in one SQLite file on your machine.",
    domain: "oh.computer",
    eyebrow: "Oh",
    mark: <OhMark />,
    theme: {
      accent: "#486B58",
      background: "#F8F7F4",
      foreground: "#1C1A18",
      muted: "#6A655E",
    },
    title: "A research graph your agents can inspect",
  });
}
