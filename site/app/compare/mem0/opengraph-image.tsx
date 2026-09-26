import {
  createSocialImageResponse,
  socialImageContentType as contentType,
  socialImageSize as size,
} from "@hraness/web-discovery/social-image";
import { compareMem0Description, compareMem0ImageAlt } from "../../metadata-copy";
import { OhSocialMark, ohSocialTheme } from "../../social-mark";

export const alt = compareMem0ImageAlt;
export { contentType, size };

export default function CompareMem0Image() {
  return createSocialImageResponse({
    description: compareMem0Description,
    domain: "oh.computer/compare/mem0",
    eyebrow: "Comparison",
    mark: <OhSocialMark />,
    theme: ohSocialTheme,
    title: "Oh vs Mem0",
  });
}
