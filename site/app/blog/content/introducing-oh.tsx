import { isArticleIndexable, type ArticleAdmission } from "@hraness/design-kit";
import type { LaunchBeat } from "@hraness/design-kit/launch";
import { SocialKitPanel } from "@hraness/design-kit/react";
import { LaunchBeats } from "@hraness/design-kit/react/server";

import { launchBeats, socialKit } from "../../launch/beats";
import { OhSurface } from "../../mockups/trail";
import { articleAdmissions } from "../admissions";

// The launch post, written as beats: each one is a short section here and one
// post in the launch threads. The words and numbers live in ../../launch.

export const toc = [] as const;

/** Where a reader goes next, named for the task. */
const GO_DEEPER: readonly { href: string; label: string }[] = [
  { href: "https://github.com/hraness/oh#install-and-first-run", label: "Install Oh and run the first example" },
  { href: "https://github.com/hraness/oh/blob/main/docs/working-memory.md", label: "Give an agent working memory it cannot promote itself" },
  { href: "/blog/oh-rust-typescript-parity", label: "See how the Rust encoder is tested against TypeScript" },
  { href: "/blog/longmemeval-s-user-log", label: "Learn how to evaluate retrieval and full conversation logs" },
  { href: "/compare", label: "Compare Oh with other agent memory tools" },
  { href: "/blog/built-on-oh", label: "See which products build on Oh" },
];

/** The beat's state object names one state of one registered surface. */
function BeatVisual({ beat }: Readonly<{ beat: LaunchBeat }>) {
  const visual = beat.visual;
  if (visual.kind !== "mockup") throw new Error(`Beat ${beat.id} names a ${visual.kind}; this post shows mockups only.`);
  const state = Object.values(visual.state)[0];
  return <OhSurface id={visual.id} state={state} />;
}

const admission: ArticleAdmission | undefined = articleAdmissions.find((record) => record.href === "/blog/introducing-oh");
const indexable = admission !== undefined && isArticleIndexable(admission);

export function IntroducingOhBody() {
  return (
    <>
      <LaunchBeats beats={launchBeats} renderVisual={(beat) => <BeatVisual beat={beat} />} />
      <h2 id="go-deeper">Go deeper</h2>
      <ul>
        {GO_DEEPER.map((link) => (
          <li key={link.href}>
            <a href={link.href}>{link.label}</a>
          </li>
        ))}
      </ul>
      {/* A quarantined post has no social kit. */}
      {indexable ? <SocialKitPanel kit={socialKit} /> : null}
    </>
  );
}
