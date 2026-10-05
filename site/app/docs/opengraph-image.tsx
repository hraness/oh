import {
  createSiteSocialImageResponse,
  socialImageContentType as contentType,
  socialImageSize as size,
} from "@hraness/web-discovery/social-image";
import { docsImageAlt, docsSocialPages, ohSocialSite } from "../social";

export const alt = docsImageAlt("/docs");
export { contentType, size };

export default function DocsImage() {
  return createSiteSocialImageResponse(ohSocialSite, docsSocialPages["/docs"]);
}
