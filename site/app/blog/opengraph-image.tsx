import {
  createSiteSocialImageResponse,
  socialImageContentType as contentType,
  socialImageSize as size,
} from "@hraness/web-discovery/social-image";
import { ohSocialSite } from "../social";
import { blogImageAlt, blogSocialPage } from "./social";

export const alt = blogImageAlt;
export { contentType, size };

export default function BlogImage() {
  return createSiteSocialImageResponse(ohSocialSite, blogSocialPage);
}
