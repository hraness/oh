import { DiagramArrowhead, MarketingDiagram } from "@hraness/design-kit/react/server";

/**
 * How Oh sits beside the agent that uses it. The host agent writes what it
 * learns and asks for recall; Oh keeps the records, their history, and the
 * ontology that types them, and answers at the level of detail the task
 * needs; a correction goes back in as a new record, never a quiet overwrite.
 */

const WIDTH = 960;
const HEIGHT = 300;

const HOST = { x: 24, y: 70, width: 232, height: 150 } as const;
const OH = { x: 348, y: 40, width: 310, height: 210 } as const;
const RESULT = { x: 752, y: 70, width: 184, height: 150 } as const;

const OH_ROWS = [
  "Records with the records they rest on",
  "A history of every change",
  "An ontology that types each record",
  "Recall at the level of detail the task needs",
] as const;

const describe =
  "Your agent sends what it learns to Oh and asks it to recall. Oh keeps records with the records they rest on, a history of every change, an ontology that types each record, and recall at the level of detail the task needs. Recall returns a summary that can open into the original record. A correction goes back to Oh as a new record, so the history keeps both versions.";

export function MechanismDiagram() {
  const arrow = "url(#oh-mechanism-arrow)";
  const midHost = HOST.y + HOST.height / 2;
  return (
    <MarketingDiagram
      caption="Your agent decides what to save and when to ask; Oh keeps the memory and answers for it. Policy stays with your code: which space to open, who may write, how long to keep records, and which model answers."
      className="oh-mechanism"
      height={HEIGHT}
      label={describe}
      width={WIDTH}
    >
      <defs><DiagramArrowhead id="oh-mechanism-arrow" /></defs>

      <g className="oh-mechanism__node" data-node="host">
        <rect height={HOST.height} rx="10" width={HOST.width} x={HOST.x} y={HOST.y} />
        <text className="oh-mechanism__title" x={HOST.x + 18} y={HOST.y + 34}>Your agent</text>
        <text className="oh-mechanism__detail" x={HOST.x + 18} y={HOST.y + 64}>Learns, asks, and acts.</text>
        <text className="oh-mechanism__detail" x={HOST.x + 18} y={HOST.y + 88}>Your harness keeps the policy:</text>
        <text className="oh-mechanism__detail" x={HOST.x + 18} y={HOST.y + 112}>spaces, permissions, retention,</text>
        <text className="oh-mechanism__detail" x={HOST.x + 18} y={HOST.y + 136}>and which model answers.</text>
      </g>

      <g className="oh-mechanism__node" data-node="oh">
        <rect height={OH.height} rx="10" width={OH.width} x={OH.x} y={OH.y} />
        <text className="oh-mechanism__title" x={OH.x + 18} y={OH.y + 34}>Oh</text>
        {OH_ROWS.map((row, index) => (
          <g key={row}>
            <circle cx={OH.x + 24} cy={OH.y + 66 + index * 36 - 5} r="4" />
            <text className="oh-mechanism__detail" x={OH.x + 38} y={OH.y + 66 + index * 36}>{row}</text>
          </g>
        ))}
      </g>

      <g className="oh-mechanism__node" data-node="result">
        <rect height={RESULT.height} rx="10" width={RESULT.width} x={RESULT.x} y={RESULT.y} />
        <text className="oh-mechanism__title" x={RESULT.x + 18} y={RESULT.y + 34}>What comes back</text>
        <text className="oh-mechanism__detail" x={RESULT.x + 18} y={RESULT.y + 64}>A summary first,</text>
        <text className="oh-mechanism__detail" x={RESULT.x + 18} y={RESULT.y + 88}>the original record</text>
        <text className="oh-mechanism__detail" x={RESULT.x + 18} y={RESULT.y + 112}>when it matters,</text>
        <text className="oh-mechanism__detail" x={RESULT.x + 18} y={RESULT.y + 136}>and where it came from.</text>
      </g>

      <g className="oh-mechanism__flow">
        <path d={`M${HOST.x + HOST.width} ${midHost - 16} H${OH.x - 6}`} markerEnd={arrow} />
        <text className="oh-mechanism__label" textAnchor="middle" x={(HOST.x + HOST.width + OH.x) / 2} y={midHost - 24}>remember, ask</text>
        <path d={`M${OH.x + OH.width} ${midHost - 16} H${RESULT.x - 6}`} markerEnd={arrow} />
        <text className="oh-mechanism__label" textAnchor="middle" x={(OH.x + OH.width + RESULT.x) / 2} y={midHost - 24}>recall</text>
      </g>

      <g className="oh-mechanism__loop">
        <path d={`M${RESULT.x + RESULT.width / 2} ${RESULT.y + RESULT.height} V${HEIGHT - 20} H${HOST.x + HOST.width / 2} V${HOST.y + HOST.height + 6}`} markerEnd={arrow} />
        <rect height="24" rx="12" width="236" x={WIDTH / 2 - 118} y={HEIGHT - 32} />
        <text className="oh-mechanism__label" textAnchor="middle" x={WIDTH / 2} y={HEIGHT - 15}>correct it: a new record, history kept</text>
      </g>
    </MarketingDiagram>
  );
}
