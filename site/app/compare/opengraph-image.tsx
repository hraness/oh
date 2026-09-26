import {
  createSocialImageResponse,
  socialImageContentType as contentType,
  socialImageSize as size,
} from "@hraness/web-discovery/social-image";
import { compareDescription, compareImageAlt } from "../metadata-copy";
import { OhSocialMark, ohSocialTheme } from "../social-mark";

export const alt = compareImageAlt;
export { contentType, size };

export default function CompareImage() {
  return createSocialImageResponse({
    description: compareDescription,
    domain: "oh.computer/compare",
    eyebrow: "Oh",
    mark: <OhSocialMark />,
    theme: ohSocialTheme,
    title: "Comparisons",
  });
}
