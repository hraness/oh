import type { ArticleVideoRecord } from "@hraness/design-kit";

/**
 * The launch film, built in video/story (story.config.ts) with the story-film
 * engine from the launch facts and the README's example review. Files live in
 * public/media; tests/launch.test.ts checks every path exists.
 */
export const launchFilm: ArticleVideoRecord = {
  name: "Introducing Oh",
  description:
    "A short captioned film about Oh: an agent remembers an answer but not its source, Oh saves the answer with the claim, evidence and source behind it, oh verify replays the change log, everything stays in one local file, and it ends with asking your agent to install Oh.",
  sources: [
    { src: "/media/oh-launch.webm", type: "video/webm" },
    { src: "/media/oh-launch.mp4", type: "video/mp4" },
  ],
  poster: "/media/oh-launch-poster.jpg",
  captions: "/media/oh-launch.vtt",
  captionsLanguage: "en",
  width: 1920,
  height: 1080,
  duration: "PT32S",
  uploadDate: "2026-10-04",
};
