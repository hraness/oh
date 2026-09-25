import {
  createSocialImageResponse,
  socialImageContentType as contentType,
  socialImageSize as size,
} from "@hraness/web-discovery/social-image";
import { OhSocialMark, ohSocialTheme } from "./social-mark";

export const alt = "Oh: Agent memory that shows its work.";
export { contentType, size };

export default function OpenGraphImage() {
  return createSocialImageResponse({
    description:
      "Oh is open-source memory for agents that stores each fact with its sources and every change in a history you can replay.",
    domain: "oh.computer",
    eyebrow: "Oh",
    mark: <OhSocialMark />,
    theme: ohSocialTheme,
    title: "Agent memory that shows its work.",
  });
}
