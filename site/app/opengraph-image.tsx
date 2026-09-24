import {
  createSocialImageResponse,
  socialImageContentType as contentType,
  socialImageSize as size,
} from "@hraness/web-discovery/social-image";
import { OhSocialMark, ohSocialTheme } from "./social-mark";

export const alt = "Oh: memory your agents can trace";
export { contentType, size };

export default function OpenGraphImage() {
  return createSocialImageResponse({
    description: "Source-backed records, local retrieval, graph proofs, and a verifiable change history. An open-source memory framework for agents.",
    domain: "oh.computer",
    eyebrow: "Oh",
    mark: <OhSocialMark />,
    theme: ohSocialTheme,
    title: "Memory your agents can trace",
  });
}
