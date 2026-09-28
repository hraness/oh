import {
  createSiteSocialImageResponse,
  socialImageContentType as contentType,
  socialImageSize as size,
} from "@hraness/web-discovery/social-image";
import { homeImageAlt, ohSocialSite } from "./social";

export const alt = homeImageAlt;
export { contentType, size };

export default function OpenGraphImage() {
  return createSiteSocialImageResponse(ohSocialSite);
}
