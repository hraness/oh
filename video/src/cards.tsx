/**
 * Cold-open cards: an agent stating things it learned earlier, with nothing
 * to show where they came from. Illustration only; the facts are the site's
 * fictional trial review and a few made-up notes.
 */
const answers = [
  "The primary endpoint was measured at 12 weeks.",
  "The team agreed to ship the importer first.",
  "That dataset was last updated in March.",
  "The API limit is per workspace, not per user.",
  "The report says the effect held in both arms.",
  "We decided against the hosted option.",
] as const;

export function OpenCard({ index }: Readonly<{ index: number }>) {
  return (
    <div className="oh-open-card">
      <span className="oh-open-who">Agent</span>
      <p className="oh-open-text">{answers[index % answers.length]}</p>
      <span className="oh-open-source">Source: ?</span>
    </div>
  );
}

export const OPEN_CARD_COUNT = answers.length;
