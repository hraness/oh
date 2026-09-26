import {
  createSocialImageResponse,
  socialImageContentType as contentType,
  socialImageSize as size,
} from "@hraness/web-discovery/social-image";
import { compareSupermemoryDescription, compareSupermemoryImageAlt } from "../../metadata-copy";
import { OhSocialMark, ohSocialTheme } from "../../social-mark";

export const alt = compareSupermemoryImageAlt;
export { contentType, size };

export default function CompareSupermemoryImage() {
  return createSocialImageResponse({
    description: compareSupermemoryDescription,
    domain: "oh.computer/compare/supermemory",
    eyebrow: "Comparison",
    mark: <OhSocialMark />,
    theme: ohSocialTheme,
    title: "Oh vs Supermemory",
  });
}
