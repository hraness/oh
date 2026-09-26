import {
  createSocialImageResponse,
  socialImageContentType as contentType,
  socialImageSize as size,
} from "@hraness/web-discovery/social-image";
import { homeDescription, homeImageAlt } from "./metadata-copy";
import { OhSocialMark, ohSocialTheme } from "./social-mark";

export const alt = homeImageAlt;
export { contentType, size };

export default function OpenGraphImage() {
  return createSocialImageResponse({
    description: homeDescription,
    domain: "oh.computer",
    eyebrow: "Oh",
    mark: <OhSocialMark />,
    theme: ohSocialTheme,
    title: "Agent memory that shows its work.",
  });
}
