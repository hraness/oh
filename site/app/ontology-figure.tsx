import type { CSSProperties } from "react";

import evidenceRecord from "../public/examples/evidence-table-2.json";
import { researchTrail, trailRecord } from "./mockups/fixtures";

/**
 * The ontology figure: three loose notes on the left resolve into the typed
 * records on the right, with the relations between them and the source each
 * one keeps. Every key, kind, and value is a record from the example review in
 * ./mockups/fixtures, which the launch tests replay against the real CLI, and
 * the digest is the one in the published example citation.
 *
 * Static SVG with CSS-only motion (see .oh-ontology in globals.css): the notes
 * fade, the lines draw, the records settle. Reduced motion shows the final
 * frame; forced colors use system colors.
 */

type Note = Readonly<{ id: string; lines: readonly string[]; targets: readonly string[] }>;

const NOTES: readonly Note[] = [
  { id: "read", lines: ["read the trial report,", "version 1"], targets: ["entity:trial-report", "edition:trial-report-v1"] },
  { id: "claim", lines: ["the endpoint was measured", "at 12 weeks, accepted"], targets: ["statement:endpoint-12-weeks", "assertion:endpoint-12-weeks"] },
  { id: "table", lines: ["table 2 supports it"], targets: ["evidence:table-2"] },
];

/** Where each record sits on the right side of the canvas. */
const PLACES: Readonly<Record<string, Readonly<{ x: number; y: number }>>> = {
  "entity:trial-report": { x: 420, y: 32 },
  "edition:trial-report-v1": { x: 420, y: 150 },
  "statement:endpoint-12-weeks": { x: 700, y: 32 },
  "assertion:endpoint-12-weeks": { x: 700, y: 150 },
  "evidence:table-2": { x: 560, y: 286 },
};

const NOTE_X = 24;
const NOTE_WIDTH = 236;
const NOTE_HEIGHT = 66;
const NOTE_Y = [52, 160, 270] as const;
const CARD_WIDTH = 236;
const CARD_HEIGHT = 74;
const WIDTH = 960;
const HEIGHT = 400;

/** The card is 236px wide; about 28 characters of 14px text fit beside its padding. */
const VALUE_CHARS = 28;

function valueLine(key: string): string {
  const value = trailRecord(key).value;
  const line = key === "evidence:table-2"
    ? `${value.locator}, ${value.relationship}`
    : value.title ?? value.captured ?? value.text ?? value.stance ?? "";
  if (line.length <= VALUE_CHARS) return line;
  const cut = line.slice(0, VALUE_CHARS);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), 12)).trimEnd()}…`;
}

function relationLabel(from: string, to: string): string {
  if (from === "edition:trial-report-v1") return "copy of";
  if (from === "assertion:endpoint-12-weeks") return "accepts";
  if (from === "evidence:table-2" && to === "edition:trial-report-v1") return "read in";
  return "supports";
}

const RECORD_KEYS = Object.keys(PLACES);
const records = RECORD_KEYS.map((key) => trailRecord(key));
const shortDigest = `${evidenceRecord.recordSha256.slice(0, 8)}…`;

const describe = [
  "Three loose notes about a trial report become five typed records.",
  "The note about reading the report becomes an entity, trial report, and an edition, version 1, that is a copy of it.",
  "The note about the endpoint becomes a statement, measured at 12 weeks, and an assertion that accepts it.",
  "The note about table 2 becomes an evidence record that was read in the edition and supports the assertion,",
  `and that record keeps its own digest, ${shortDigest}.`,
].join(" ");

export function OntologyFigure() {
  // Edges between records follow each record's declared dependencies.
  const relations = records.flatMap((record) => record.dependsOn
    .filter((target) => target in PLACES)
    .map((target) => ({ from: record.key, to: target })));
  return (
    <figure className="oh-ontology" data-nosnippet="">
      <div aria-label="Loose notes resolving into typed records" className="oh-ontology__scroll" role="region" tabIndex={0}>
      <svg
        aria-label={describe}
        className="oh-ontology__canvas"
        role="img"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      >
        <title>{describe}</title>
        <defs>
          <marker id="oh-ontology-arrow" markerHeight="7" markerUnits="userSpaceOnUse" markerWidth="7" orient="auto-start-reverse" refX="6" refY="3.5" viewBox="0 0 7 7">
            <path d="M0 0 L7 3.5 L0 7 Z" fill="context-stroke" />
          </marker>
        </defs>

        <text className="oh-ontology__column" x={NOTE_X} y={20}>Loose notes</text>
        <text className="oh-ontology__column" x={420} y={16}>Typed records, with what each one came from</text>

        {NOTES.map((note, index) => {
          const y = NOTE_Y[index] ?? 0;
          return (
            <g className="oh-ontology__note" key={note.id} style={{ "--oh-step": index } as CSSProperties}>
              <rect height={NOTE_HEIGHT} rx="6" width={NOTE_WIDTH} x={NOTE_X} y={y} />
              {note.lines.map((line, lineIndex) => (
                <text key={line} x={NOTE_X + 16} y={y + 28 + lineIndex * 22}>{line}</text>
              ))}
            </g>
          );
        })}

        {NOTES.flatMap((note, index) => note.targets.map((target) => {
          const place = PLACES[target];
          if (place === undefined) throw new RangeError(`No place for ${target}.`);
          const y = (NOTE_Y[index] ?? 0) + NOTE_HEIGHT / 2;
          const x1 = NOTE_X + NOTE_WIDTH;
          const y2 = place.y + CARD_HEIGHT / 2;
          const x2 = place.x;
          const bend = x1 + (x2 - x1) * 0.55;
          return (
            <path
              className="oh-ontology__resolve"
              d={`M${x1} ${y} C${bend} ${y} ${bend} ${y2} ${x2 - 4} ${y2}`}
              key={`${note.id}-${target}`}
              markerEnd="url(#oh-ontology-arrow)"
              style={{ "--oh-step": index } as CSSProperties}
            />
          );
        }))}

        {relations.map(({ from, to }) => {
          const a = PLACES[from];
          const b = PLACES[to];
          if (a === undefined || b === undefined) throw new RangeError(`No place for ${from} or ${to}.`);
          const sameColumn = a.x === b.x;
          const x1 = a.x + CARD_WIDTH / 2;
          const y1 = a.y;
          const x2 = b.x + CARD_WIDTH / 2;
          const y2 = b.y + CARD_HEIGHT + 4;
          const d = sameColumn
            ? `M${x1} ${y1} L${x2} ${y2}`
            : `M${x1} ${y1} C${x1} ${y1 - 40} ${x2} ${y2 + 40} ${x2} ${y2}`;
          const labelX = (x1 + x2) / 2;
          const labelY = (y1 + y2) / 2;
          return (
            <g className="oh-ontology__relation" key={`${from}-${to}`}>
              <path d={d} markerEnd="url(#oh-ontology-arrow)" />
              <rect height="20" rx="10" width={relationLabel(from, to).length * 8 + 14} x={labelX - (relationLabel(from, to).length * 8 + 14) / 2} y={labelY - 10} />
              <text textAnchor="middle" x={labelX} y={labelY + 4}>{relationLabel(from, to)}</text>
            </g>
          );
        })}

        {records.map((record) => {
          const place = PLACES[record.key];
          if (place === undefined) throw new RangeError(`No place for ${record.key}.`);
          const withDigest = record.key === "evidence:table-2";
          const step = NOTES.findIndex((note) => note.targets.includes(record.key));
          return (
            <g className="oh-ontology__record" data-kind={record.kind} key={record.key} style={{ "--oh-step": step } as CSSProperties}>
              <rect height={CARD_HEIGHT} rx="8" width={CARD_WIDTH} x={place.x} y={place.y} />
              <text className="oh-ontology__kind" x={place.x + 14} y={place.y + 20}>{record.kind}</text>
              <text className="oh-ontology__key" x={place.x + 14} y={place.y + 42}>{record.key}</text>
              <text className="oh-ontology__value" x={place.x + 14} y={place.y + 62}>{valueLine(record.key)}</text>
              {withDigest ? (
                <g className="oh-ontology__source">
                  <rect height="22" rx="11" width="150" x={place.x + CARD_WIDTH - 162} y={place.y + 8} />
                  <text textAnchor="middle" x={place.x + CARD_WIDTH - 87} y={place.y + 23}>sha256 {shortDigest}</text>
                </g>
              ) : null}
            </g>
          );
        })}
      </svg>
      </div>
      <figcaption>
        An agent’s notes about a trial report, saved as records of the kinds Oh’s ontology names. Each record keeps the records it depends on and a digest of its own bytes, so a later answer can be followed back to the copy of the report the agent read. The notes and the report are illustrations; the records and digest are real output of the <code>oh</code> CLI.
      </figcaption>
    </figure>
  );
}

export const ontologyRecordCount = researchTrail.length;
