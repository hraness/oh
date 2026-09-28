import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// This file imports the site's own dependencies, so it runs only in the site
// workspace; the root check reads site/tests/source.test.ts without them.
const site = join(import.meta.dir, "..");
const read = async (path: string): Promise<string> =>
  await readFile(join(site, path), "utf8");

describe("Oh IndexNow submission", () => {
  test("submits only oh.computer paths to IndexNow with the served key", async () => {
    const { maximumIndexNowPaths, ohIndexNowKey, ohIndexNowPayload } = await import("../scripts/indexnow");
    expect((await read(`public/${ohIndexNowKey}.txt`)).trim()).toBe(ohIndexNowKey);
    const payload = ohIndexNowPayload(["--", "/", "/compare", "/compare"]);
    expect(payload).toEqual({
      host: "oh.computer",
      key: ohIndexNowKey,
      keyLocation: `https://oh.computer/${ohIndexNowKey}.txt`,
      urlList: ["https://oh.computer/", "https://oh.computer/compare"],
    });
    expect(() => ohIndexNowPayload([])).toThrow(RangeError);
    expect(() => ohIndexNowPayload(["https://example.com/"])).toThrow();
    expect(() => ohIndexNowPayload(Array.from({ length: maximumIndexNowPaths + 1 }, (_, index) => `/p${index}`))).toThrow(RangeError);
  });
});
