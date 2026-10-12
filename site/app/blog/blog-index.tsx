import { formatArticleDate, type ArticleIsoDate } from "@hraness/design-kit";

import { articlePath, type OhArticle } from "./articles";

/**
 * The blog index with a card image for each post. The design kit's ArticleIndex
 * lists title, dek, and dates; this list keeps its markup and classes and adds
 * one illustration per post, drawn from palette tokens so it renders in both
 * appearances and in forced colors.
 */

type Motif = "benchmark" | "announcement" | "technique" | "integration";

const MOTIFS: Readonly<Record<string, Motif>> = {
  Announcement: "announcement",
  Benchmark: "benchmark",
  Integration: "integration",
  Technique: "technique",
};

function motifFor(eyebrow: string): Motif {
  const motif = MOTIFS[eyebrow];
  if (motif === undefined) throw new Error(`No card image for the ${eyebrow} eyebrow.`);
  return motif;
}

/** Four bars, the tallest first: a benchmark table at a glance. */
function BenchmarkArt() {
  const heights = [52, 46, 38, 34] as const;
  return (
    <>
      {heights.map((height, index) => (
        <rect
          className="blog-card__bar"
          height={height}
          key={height}
          rx={2}
          width={18}
          x={22 + index * 30}
          y={76 - height}
        />
      ))}
      <line className="blog-card__rule" x1={16} x2={144} y1={76} y2={76} />
    </>
  );
}

/** A question, a claim, and the record behind it, joined by edges. */
function AnnouncementArt() {
  return (
    <>
      <path className="blog-card__edge" d="M40 30 L80 56 L120 30" />
      <path className="blog-card__edge" d="M80 56 L80 86" />
      <circle className="blog-card__node" cx={40} cy={30} r={9} />
      <circle className="blog-card__node" cx={120} cy={30} r={9} />
      <circle className="blog-card__node blog-card__node--primary" cx={80} cy={56} r={11} />
      <rect className="blog-card__record" height={16} rx={3} width={36} x={62} y={86} />
    </>
  );
}

/** Two encoders, one byte string: an equals sign between two tiles. */
function TechniqueArt() {
  return (
    <>
      <rect className="blog-card__record" height={44} rx={4} width={40} x={18} y={34} />
      <rect className="blog-card__record" height={44} rx={4} width={40} x={102} y={34} />
      <line className="blog-card__edge blog-card__edge--thick" x1={70} x2={90} y1={50} y2={50} />
      <line className="blog-card__edge blog-card__edge--thick" x1={70} x2={90} y1={62} y2={62} />
      <line className="blog-card__rule" x1={26} x2={50} y1={48} y2={48} />
      <line className="blog-card__rule" x1={26} x2={44} y1={58} y2={58} />
      <line className="blog-card__rule" x1={110} x2={134} y1={48} y2={48} />
      <line className="blog-card__rule" x1={110} x2={128} y1={58} y2={58} />
    </>
  );
}

/** Oh in the middle, two products linked to it. */
function IntegrationArt() {
  return (
    <>
      <path className="blog-card__edge" d="M48 56 L68 56" />
      <path className="blog-card__edge" d="M92 56 L112 56" />
      <rect className="blog-card__record" height={28} rx={4} width={28} x={20} y={42} />
      <rect className="blog-card__record" height={28} rx={4} width={28} x={112} y={42} />
      <circle className="blog-card__node blog-card__node--primary" cx={80} cy={56} r={13} />
    </>
  );
}

const ART: Readonly<Record<Motif, () => React.JSX.Element>> = {
  announcement: AnnouncementArt,
  benchmark: BenchmarkArt,
  integration: IntegrationArt,
  technique: TechniqueArt,
};

function CardArt({ motif }: Readonly<{ motif: Motif }>) {
  const Art = ART[motif];
  return (
    <svg aria-hidden="true" className={`blog-card blog-card--${motif}`} focusable="false" viewBox="0 0 160 112">
      <rect className="blog-card__paper" height={112} width={160} x={0} y={0} />
      <Art />
    </svg>
  );
}

function EntryDate({ label, value }: Readonly<{ label: string; value: ArticleIsoDate }>) {
  return <>{label} <time dateTime={value}>{formatArticleDate(value)}</time></>;
}

export function BlogIndexList({ articles, summary }: Readonly<{ articles: readonly OhArticle[]; summary: string }>) {
  return (
    <section
      aria-labelledby="blog-title"
      className="plain-site plain-publication plain-publication--embedded plain-publication__list"
      data-hraness-article-index=""
    >
      <div className="plain-publication__section-heading">
        <h1 id="blog-title">Blog</h1>
        <p>{summary}</p>
      </div>
      <div className="plain-publication__article-list">
        {articles.map((article) => (
          <article className="plain-publication__entry blog-entry" key={article.slug}>
            <CardArt motif={motifFor(article.eyebrow)} />
            <div className="blog-entry__text">
              <p className="plain-publication__entry-label">{article.eyebrow}</p>
              <h2 className="plain-publication__entry-title"><a href={articlePath(article)}>{article.title}</a></h2>
              <p className="plain-publication__entry-dek">{article.dek}</p>
              <p className="plain-publication__entry-meta">
                <EntryDate label="Published" value={article.published} />
                {article.updated === article.published ? null : <> · <EntryDate label="Updated" value={article.updated} /></>}
              </p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
