import {
  createSiteSocialImageResponse,
  socialImageContentType as contentType,
  socialImageSize as size,
} from "@hraness/web-discovery/social-image";
import { specificationImageAlt, ohSocialSite, specificationSocialPage } from "../social";

export const alt = specificationImageAlt;
export { contentType, size };

export default function SpecificationImage() {
  return createSiteSocialImageResponse(ohSocialSite, specificationSocialPage);
}
