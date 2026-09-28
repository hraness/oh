import {
  createSocialImageResponse,
  socialImageContentType as contentType,
  socialImageSize as size,
} from "@hraness/web-discovery/social-image";
import { blogImageAlt } from "../metadata-copy";
import { OhSocialMark, ohSocialTheme } from "../social-mark";
import { blogDescription } from "./articles";

export const alt = blogImageAlt;
export { contentType, size };

export default function BlogImage() {
  return createSocialImageResponse({
    description: blogDescription,
    domain: "oh.computer/blog",
    eyebrow: "Oh",
    mark: <OhSocialMark />,
    theme: ohSocialTheme,
    title: "Blog",
  });
}
