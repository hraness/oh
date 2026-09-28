import {
  createSiteSocialImageResponse,
  socialImageContentType as contentType,
  socialImageSize as size,
} from "@hraness/web-discovery/social-image";
import { compareSupermemoryImageAlt, ohSocialSite, compareSupermemorySocialPage } from "../../social";

export const alt = compareSupermemoryImageAlt;
export { contentType, size };

export default function CompareSupermemoryImage() {
  return createSiteSocialImageResponse(ohSocialSite, compareSupermemorySocialPage);
}
