import {
  createSiteSocialImageResponse,
  socialImageContentType as contentType,
  socialImageSize as size,
} from "@hraness/web-discovery/social-image";
import { compareImageAlt, ohSocialSite, compareSocialPage } from "../social";

export const alt = compareImageAlt;
export { contentType, size };

export default function CompareImage() {
  return createSiteSocialImageResponse(ohSocialSite, compareSocialPage);
}
