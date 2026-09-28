import { createIndexNowPayload, parseOwnedPath, type OwnedPath } from "@hraness/web-discovery";

export const ohOrigin = "https://oh.computer";
/** Served verbatim at /<key>.txt from site/public so IndexNow can confirm ownership. */
export const ohIndexNowKey = "e723211bf010b856728ff77c19f051c9";
/** IndexNow accepts up to 10,000 URLs per request; Oh's sitemap is far smaller, so a long list is a mistake. */
export const maximumIndexNowPaths = 100;

/** Parses command-line path arguments into one IndexNow payload for oh.computer. */
export function ohIndexNowPayload(argv: readonly string[]) {
  const paths: OwnedPath[] = argv.filter((argument) => argument !== "--").map(parseOwnedPath);
  if (paths.length === 0) {
    throw new RangeError("Name at least one oh.computer path, such as / or /compare.");
  }
  if (paths.length > maximumIndexNowPaths) {
    throw new RangeError(`Submit at most ${maximumIndexNowPaths} paths at a time; got ${paths.length}.`);
  }
  return createIndexNowPayload(ohOrigin, ohIndexNowKey, paths);
}
