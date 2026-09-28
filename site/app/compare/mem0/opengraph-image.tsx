import {
  createSiteSocialImageResponse,
  socialImageContentType as contentType,
  socialImageSize as size,
} from "@hraness/web-discovery/social-image";
import { compareMem0ImageAlt, ohSocialSite, compareMem0SocialPage } from "../../social";

export const alt = compareMem0ImageAlt;
export { contentType, size };

export default function CompareMem0Image() {
  return createSiteSocialImageResponse(ohSocialSite, compareMem0SocialPage);
}
