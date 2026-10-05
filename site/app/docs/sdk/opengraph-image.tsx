import {
  createSiteSocialImageResponse,
  socialImageContentType as contentType,
  socialImageSize as size,
} from "@hraness/web-discovery/social-image";
import { docsImageAlt, docsSocialPages, ohSocialSite } from "../../social";

export const alt = docsImageAlt("/docs/sdk");
export { contentType, size };

export default function SdkDocsImage() {
  return createSiteSocialImageResponse(ohSocialSite, docsSocialPages["/docs/sdk"]);
}
