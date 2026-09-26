import {
  createSocialImageResponse,
  socialImageContentType as contentType,
  socialImageSize as size,
} from "@hraness/web-discovery/social-image";
import { benchmarksDescription, benchmarksImageAlt } from "../metadata-copy";
import { OhSocialMark, ohSocialTheme } from "../social-mark";

export const alt = benchmarksImageAlt;
export { contentType, size };

export default function BenchmarksImage() {
  return createSocialImageResponse({
    description: benchmarksDescription,
    domain: "oh.computer/benchmarks",
    eyebrow: "Oh",
    mark: <OhSocialMark />,
    theme: ohSocialTheme,
    title: "Benchmark results",
  });
}
