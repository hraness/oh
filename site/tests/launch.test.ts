import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { assertLaunchKit } from "@hraness/design-kit/launch";

import { marketing } from "../portfolio-copy";
import { LAUNCH_POST_URL, launchBeats, launchKitOptions, socialKit } from "../app/launch/beats";
import { renderSocialKitMarkdown } from "../app/launch/social-kit-markdown";

const root = join(import.meta.dir, "../..");
const read = (path: string) => readFile(join(root, path), "utf8");
const channels = () => [...socialKit.x, ...socialKit.bluesky, ...socialKit.threads, socialKit.linkedin,
  socialKit.productHunt.description, ...socialKit.showHnFacts];

describe("launch beats and social kit", () => {
  test("every beat resolves, and the social kit passes the design kit's checks", () => {
    expect(launchBeats.map((beat) => beat.id)).toEqual(["what", "trace", "ask", "propose", "adopt", "history", "who", "rust", "limits", "status"]);
    for (const beat of launchBeats) expect(beat.post).not.toMatch(/\{\w+\}/);
    expect(() => assertLaunchKit(launchBeats, socialKit, launchKitOptions)).not.toThrow();
    // The limits beat stays in the post and never becomes a social post.
    expect(socialKit.x).toHaveLength(launchBeats.length - 1);
    expect(socialKit.x.at(-1)).toContain(LAUNCH_POST_URL);
  });

  test("the Product Hunt tagline is the portfolio tagline", () => {
    expect(socialKit.productHunt.tagline).toBe(marketing.tagline);
  });

  test("the launch keeps verification scope separate from the social posts", async () => {
    const limits = launchBeats.find((beat) => beat.id === "limits");
    expect(limits?.post).toMatch(/Verification checks.*records.*history/u);
    expect(limits?.post).toMatch(/truth.*evidence/u);
    const who = launchBeats.find((beat) => beat.id === "who");
    expect(who?.post).toContain("Oh is more than you need");
    for (const text of channels()) {
      expect(text).not.toContain("has not shown");
      expect(text).not.toContain("not whether a claim is true");
      expect(text).not.toContain("Sync stops");
      expect(text).not.toContain("more than you need");
    }
  });
});

describe("site/app/launch/social-kit.md", () => {
  test("matches the beats and facts; run `bun run launch:kit` after changing them", async () => {
    expect(await read("site/app/launch/social-kit.md")).toBe(renderSocialKitMarkdown());
  });
});
