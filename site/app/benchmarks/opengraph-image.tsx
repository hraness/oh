import {
  createSiteSocialImageResponse,
  socialImageContentType as contentType,
  socialImageSize as size,
} from "@hraness/web-discovery/social-image";
import { benchmarksImageAlt, ohSocialSite, benchmarksSocialPage } from "../social";

export const alt = benchmarksImageAlt;
export { contentType, size };

export default function BenchmarksImage() {
  return createSiteSocialImageResponse(ohSocialSite, benchmarksSocialPage);
}
