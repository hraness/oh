import {
  createSocialImageResponse,
  socialImageContentType as contentType,
  socialImageSize as size,
} from "@hraness/web-discovery/social-image";
import { specificationDescription, specificationTitle } from "../metadata-copy";
import { OhSocialMark, ohSocialTheme } from "../social-mark";

export const alt = specificationTitle;
export { contentType, size };

export default function SpecificationImage() {
  return createSocialImageResponse({
    description: specificationDescription,
    domain: "oh.computer/spec",
    eyebrow: "Oh",
    mark: <OhSocialMark />,
    theme: ohSocialTheme,
    title: "Ontology specification v1",
  });
}
