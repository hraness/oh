import { canonicalJson, canonicalSha256, hasExactKeys, sha256Hex, isPlainRecord } from "../../src/canonical";

export type Turn = Readonly<{ id: string; sessionId: string; sessionIndex?: number; date: string; speaker: string; text: string }>;
export type Corpus = Readonly<{ id: string; groupId: string; turns: readonly Turn[] }>;
export type Question = Readonly<{
  id: string; corpusId: string; category: string; question: string; questionDate: string;
  answer: string; unanswerable: boolean; evidenceTurnIds: readonly string[]; evidenceSessionIds: readonly string[];
  rawEvidenceTurnIds?: readonly string[];
}>;
export const EVIDENCE_REFERENCE_PROTOCOL = "oh.evidence-references.v2" as const;
export type Dataset = Readonly<{ corpora: readonly Corpus[]; questions: readonly Question[] }>;
export type Split = "dev" | "test" | "all";
export type DatasetName = keyof typeof DATASETS;

/** The canonical JSON re-encoding of the pinned BEAM parquet release (scripts/benchmarks/beam-parquet-to-json.py). */
export const BEAM_CANONICAL_PROTOCOL = "oh.beam-source-canonical.v1" as const;
export const BEAM_SPLITS = ["100K", "500K", "1M"] as const;
export type BeamSplit = (typeof BEAM_SPLITS)[number];
export const BEAM_QUESTION_TYPES = ["abstention", "contradiction_resolution", "event_ordering", "information_extraction",
  "instruction_following", "knowledge_update", "multi_session_reasoning", "preference_following", "summarization",
  "temporal_reasoning"] as const;
/** Every BEAM probing question is asked after the whole history; its date is the last session's time anchor. */
export const BEAM_QUESTION_DATE_POLICY = "beam-last-session-time-anchor.v1" as const;

export const DATASETS = {
  beam: {
    bytes: 285_187_170,
    revision: "3205395e897e7318c7b094ef4e6047b9b82dbb03",
    sha256: "8280371b8322fc39af44489a65c698c9e48e7feafddcca012d64ba75d54ff2f4",
    url: "https://huggingface.co/datasets/Mohammadta/BEAM/tree/3205395e897e7318c7b094ef4e6047b9b82dbb03/data",
    encoding: BEAM_CANONICAL_PROTOCOL,
    license: "CC-BY-SA-4.0",
    parts: [
      { split: "100K", path: "data/100K-00000-of-00001.parquet", bytes: 5_429_768,
        sha256: "c0519be25907005ba873c927c50877471d550873039d96c041554d0075a78ace" },
      { split: "500K", path: "data/500K-00000-of-00001.parquet", bytes: 33_956_263,
        sha256: "af05921c979355038e1761b7cde3d2dd713200dd3071b278de0200f6c7f30122" },
      { split: "1M", path: "data/1M-00000-of-00001.parquet", bytes: 66_156_374,
        sha256: "41b5acbbb55a586b1305514ef9d9fb03365d9b3331b598a1c2dd7603d93ef533" },
    ],
  },
  locomo: {
    bytes: 2_805_274,
    revision: "3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376",
    sha256: "79fa87e90f04081343b8c8debecb80a9a6842b76a7aa537dc9fdf651ea698ff4",
    url: "https://raw.githubusercontent.com/snap-research/locomo/3eb6f2c585f5e1699204e3c3bdf7adc5c28cb376/data/locomo10.json",
  },
  "longmemeval-oracle": {
    bytes: 15_388_478,
    revision: "98d7416c24c778c2fee6e6f3006e7a073259d48f",
    sha256: "821a2034d219ab45846873dd14c14f12cfe7776e73527a483f9dac095d38620c",
    url: "https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/98d7416c24c778c2fee6e6f3006e7a073259d48f/longmemeval_oracle.json",
  },
  "longmemeval-s": {
    bytes: 277_383_467,
    revision: "98d7416c24c778c2fee6e6f3006e7a073259d48f",
    sha256: "d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442",
    url: "https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned/resolve/98d7416c24c778c2fee6e6f3006e7a073259d48f/longmemeval_s_cleaned.json",
  },
} as const;

function object(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new TypeError(`${label} must be an object.`);
  return value;
}

function text(value: unknown, label: string, maximum = 524_288): string {
  if (typeof value !== "string" || Buffer.byteLength(value) > maximum) {
    throw new TypeError(`${label} must be bounded text.`);
  }
  return value;
}

function id(value: unknown, label: string): string {
  const result = text(value, label, 512);
  if (result.length === 0) throw new TypeError(`${label} cannot be empty.`);
  return result;
}

function array(value: unknown, label: string, maximum = 20_000): unknown[] {
  if (!Array.isArray(value) || value.length > maximum) throw new TypeError(`${label} must be a bounded array.`);
  return value;
}

function strings(value: unknown, label: string): string[] {
  return [...new Set(array(value, label).map((item) => id(item, label)))];
}

function answer(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return text(value, "answer");
}

function validateDataset(dataset: Dataset): Dataset {
  if (dataset.corpora.length === 0 || dataset.questions.length === 0) throw new TypeError("Dataset cannot be empty.");
  const unique = (values: readonly string[], label: string) => {
    if (new Set(values).size !== values.length) throw new TypeError(`Dataset contains duplicate ${label}.`);
  };
  unique(dataset.corpora.map((corpus) => corpus.id), "corpora");
  unique(dataset.questions.map((question) => question.id), "questions");
  for (const corpus of dataset.corpora) {
    if (corpus.turns.length === 0 || corpus.turns.length > 8_192) throw new RangeError("Corpus turn bound exceeded or empty.");
    unique(corpus.turns.map((turn) => turn.id), "turn IDs");
  }
  return dataset;
}

function locomoEvidence(raw: readonly string[], knownIds: ReadonlySet<string>): string[] {
  return [...new Set(raw.flatMap((entry) => {
    if (knownIds.has(entry)) return [entry];
    const plain = entry.trim().replace(/\((D\d+:\d+)\)/g, "$1");
    if (!/^D\d+:\d+(?:[\s,;]+D\d+:\d+)*$/.test(plain)) return [entry];
    return (plain.match(/D\d+:\d+/g) ?? []).map((reference) => {
      if (knownIds.has(reference)) return reference;
      const normalized = reference.replace(/^D0*(\d+):0*(\d+)$/, "D$1:$2");
      return knownIds.has(normalized) ? normalized : reference;
    });
  }))];
}

export function parseLocomo(value: unknown): Dataset {
  const corpora: Corpus[] = [];
  const questions: Question[] = [];
  for (const candidate of array(value, "LoCoMo", 1_000)) {
    const sample = object(candidate, "sample");
    const corpusId = id(sample.sample_id, "sample_id");
    const conversation = object(sample.conversation, "conversation");
    const sessions = Object.keys(conversation).filter((key) => /^session_\d+$/.test(key))
      .sort((left, right) => Number(left.slice(8)) - Number(right.slice(8)));
    const turns: Turn[] = [];
    for (const sessionId of sessions) {
      const date = text(conversation[`${sessionId}_date_time`], "session timestamp", 256);
      for (const raw of array(conversation[sessionId], "session", 8_192)) {
        const turn = object(raw, "turn");
        const caption = turn.blip_caption === undefined ? "" : text(turn.blip_caption, "image caption");
        turns.push({ id: id(turn.dia_id, "dia_id"), sessionId, date,
          speaker: id(turn.speaker, "speaker"), text: text(turn.text, "turn text")
            + (caption ? `\n[Image caption: ${caption}]` : "") });
      }
    }
    const byId = new Map(turns.map((turn) => [turn.id, turn]));
    const knownIds = new Set(byId.keys());
    corpora.push({ id: corpusId, groupId: corpusId, turns });
    for (const [index, raw] of array(sample.qa, "qa").entries()) {
      const qa = object(raw, "question");
      if (!Number.isInteger(qa.category) || Number(qa.category) < 1 || Number(qa.category) > 5) {
        throw new TypeError("Invalid LoCoMo category.");
      }
      const unanswerable = qa.category === 5;
      const rawEvidenceTurnIds = array(qa.evidence, "evidence").map((entry) => id(entry, "evidence"));
      const evidenceTurnIds = locomoEvidence(rawEvidenceTurnIds, knownIds);
      questions.push({ id: `${corpusId}:${index}`, corpusId, category: `locomo:${qa.category}`,
        question: text(qa.question, "question", 16_384), questionDate: "",
        answer: unanswerable ? "" : answer(qa.answer), unanswerable, evidenceTurnIds, rawEvidenceTurnIds,
        evidenceSessionIds: [...new Set(evidenceTurnIds.flatMap((turnId) => {
          const turn = byId.get(turnId);
          return turn ? [turn.sessionId] : [];
        }))] });
    }
  }
  return validateDataset({ corpora, questions });
}

export function parseLongMemEval(value: unknown): Dataset {
  const corpora: Corpus[] = [];
  const questions: Question[] = [];
  const categories = new Set(["single-session-user", "single-session-assistant", "single-session-preference",
    "multi-session", "temporal-reasoning", "knowledge-update"]);
  for (const raw of array(value, "LongMemEval", 2_000)) {
    const item = object(raw, "question");
    const corpusId = id(item.question_id, "question_id");
    const category = id(item.question_type, "question_type");
    if (!categories.has(category)) throw new TypeError("Invalid LongMemEval category.");
    const sessions = array(item.haystack_sessions, "haystack_sessions", 1_000);
    const sessionIds = array(item.haystack_session_ids, "haystack_session_ids", 1_000)
      .map((entry) => id(entry, "session ID"));
    const dates = array(item.haystack_dates, "haystack_dates", 1_000);
    if (sessions.length !== sessionIds.length || sessions.length !== dates.length) {
      throw new TypeError(`Haystack ${corpusId}: ${sessions.length} sessions, ${sessionIds.length} IDs, ${dates.length} dates.`);
    }
    const occurrences = new Map<string, number>();
    for (const sessionId of sessionIds) occurrences.set(sessionId, (occurrences.get(sessionId) ?? 0) + 1);
    const turns: Turn[] = [];
    const evidenceTurnIds: string[] = [];
    for (const [index, session] of sessions.entries()) {
      const sessionId = sessionIds[index]!;
      const date = text(dates[index], "session timestamp", 256);
      for (const [turnIndex, rawTurn] of array(session, "session", 8_192).entries()) {
        const turn = object(rawTurn, "turn");
        const turnId = `${sessionId}${occurrences.get(sessionId)! > 1 ? `#${index}` : ""}:${turnIndex}`;
        if (turn.has_answer !== undefined && typeof turn.has_answer !== "boolean") throw new TypeError("Invalid has_answer label.");
        if (turn.has_answer === true) evidenceTurnIds.push(turnId);
        turns.push({ id: turnId, sessionId, sessionIndex: index, date,
          speaker: id(turn.role, "role"), text: text(turn.content, "content") });
      }
    }
    turns.sort((left, right) => left.date < right.date ? -1 : left.date > right.date ? 1 : 0);
    corpora.push({ id: corpusId, groupId: corpusId.replace(/_abs$/, ""), turns });
    questions.push({ id: corpusId, corpusId, category, question: text(item.question, "question", 16_384),
      questionDate: text(item.question_date, "question_date", 256), answer: answer(item.answer),
      unanswerable: corpusId.endsWith("_abs"), evidenceTurnIds,
      evidenceSessionIds: strings(item.answer_session_ids, "answer_session_ids") });
  }
  return validateDataset({ corpora, questions });
}

export function beamCorpusId(split: BeamSplit, rowIndex: number): string {
  if (!BEAM_SPLITS.includes(split) || !Number.isSafeInteger(rowIndex) || rowIndex < 0 || rowIndex > 999) {
    throw new TypeError("Invalid BEAM corpus coordinates.");
  }
  return `beam-${split}-${rowIndex}`;
}

const BEAM_ROOT_KEYS = ["parts", "protocol", "revision", "rows"] as const;
const BEAM_ROW_KEYS = ["chat", "conversation_id", "conversation_plan", "conversation_seed", "narratives", "probing_questions",
  "rowIndex", "split", "user_profile", "user_questions"] as const;
const BEAM_TURN_KEYS = ["content", "id", "index", "question_type", "role", "time_anchor"] as const;

/** Parse a BEAM row's evidence references: integers anywhere in a bounded list/object tree. */
function beamSourceChatIds(value: unknown, depth = 0): number[] {
  if (depth > 4) throw new TypeError("BEAM source_chat_ids nesting bound exceeded.");
  if (value === undefined || value === null) return [];
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError("BEAM source_chat_ids must be non-negative integers.");
    return [value];
  }
  if (Array.isArray(value)) return array(value, "source_chat_ids", 1_024).flatMap((item) => beamSourceChatIds(item, depth + 1));
  if (isPlainRecord(value)) {
    const keys = Object.keys(value).sort();
    if (keys.length > 32) throw new TypeError("BEAM source_chat_ids object bound exceeded.");
    return keys.flatMap((key) => beamSourceChatIds(value[key], depth + 1));
  }
  throw new TypeError("BEAM source_chat_ids must be integers.");
}

type BeamRow = Readonly<{ row: Record<string, unknown>; split: BeamSplit; rowIndex: number; corpusId: string }>;

/** Authenticate the canonical BEAM envelope (protocol, pinned parts, row coordinates) before any row is read. */
function beamRows(value: unknown): readonly BeamRow[] {
  const root = object(value, "BEAM");
  if (!hasExactKeys(root, BEAM_ROOT_KEYS)) throw new TypeError("BEAM document has an unexpected shape.");
  if (root.protocol !== BEAM_CANONICAL_PROTOCOL) throw new TypeError("Unexpected BEAM encoding protocol.");
  if (root.revision !== DATASETS.beam.revision) throw new TypeError("BEAM revision does not match the pinned source.");
  const parts = array(root.parts, "parts", 8).map((raw) => {
    const part = object(raw, "part");
    if (!hasExactKeys(part, ["bytes", "path", "rows", "sha256", "split"])) throw new TypeError("BEAM part has an unexpected shape.");
    const pinned = DATASETS.beam.parts.find((candidate) => candidate.split === part.split);
    if (pinned === undefined || pinned.path !== part.path || pinned.bytes !== part.bytes || pinned.sha256 !== part.sha256) {
      throw new TypeError("BEAM part does not match the pinned parquet release.");
    }
    const rows = part.rows;
    if (!Number.isSafeInteger(rows) || (rows as number) < 1 || (rows as number) > 1_000) throw new TypeError("Invalid BEAM part row count.");
    return { split: pinned.split as BeamSplit, rows: rows as number };
  });
  if (parts.length !== DATASETS.beam.parts.length || new Set(parts.map((part) => part.split)).size !== parts.length) {
    throw new TypeError("BEAM parts must cover every pinned split once.");
  }
  const expectedRows = new Map(parts.map((part) => [part.split, part.rows]));
  const seen = new Map<BeamSplit, Set<number>>();
  const rows = array(root.rows, "rows", 1_000).map((raw) => {
    const row = object(raw, "row");
    if (!hasExactKeys(row, BEAM_ROW_KEYS)) throw new TypeError("BEAM row has an unexpected shape.");
    const split = row.split;
    if (typeof split !== "string" || !BEAM_SPLITS.includes(split as BeamSplit)) throw new TypeError("Unknown BEAM split.");
    const rowIndex = row.rowIndex;
    if (!Number.isSafeInteger(rowIndex) || (rowIndex as number) < 0 || (rowIndex as number) >= expectedRows.get(split as BeamSplit)!) {
      throw new TypeError("BEAM rowIndex is outside its split.");
    }
    const indices = seen.get(split as BeamSplit) ?? new Set<number>();
    if (indices.has(rowIndex as number)) throw new TypeError("BEAM rowIndex repeats within its split.");
    indices.add(rowIndex as number);
    seen.set(split as BeamSplit, indices);
    id(row.conversation_id, "conversation_id");
    return { row, split: split as BeamSplit, rowIndex: rowIndex as number, corpusId: beamCorpusId(split as BeamSplit, rowIndex as number) };
  });
  for (const part of parts) {
    if ((seen.get(part.split)?.size ?? 0) !== part.rows) throw new TypeError("BEAM split row count does not match its part.");
  }
  return rows;
}

/**
 * Parse the canonical BEAM re-encoding. Memory systems receive only chat turns
 * with their session time anchors; author plans, profiles, narratives, seeds,
 * planted turn labels (`question_type`, `index`) and every probing-question
 * field stay outside the corpus. `Question.answer` carries the scorer-side
 * probing object as canonical JSON (rubric nuggets and reference answers) for a
 * later BEAM scoring lane; it never enters ingestion.
 */
export function parseBeam(value: unknown): Dataset {
  const corpora: Corpus[] = [];
  const questions: Question[] = [];
  for (const { row, corpusId } of beamRows(value)) {
    const turns: Turn[] = [];
    const bySourceId = new Map<number, string[]>();
    const sessions = array(row.chat, "chat", 64);
    if (sessions.length === 0) throw new TypeError("BEAM history has no sessions.");
    let lastSessionDate = "";
    for (const [sessionIndex, rawSession] of sessions.entries()) {
      const sessionId = `s${sessionIndex}`;
      const rawTurns = array(rawSession, "session", 8_192);
      if (rawTurns.length === 0) throw new TypeError("BEAM session has no turns.");
      const parsedTurns = rawTurns.map((rawTurn) => {
        const turn = object(rawTurn, "turn");
        if (!hasExactKeys(turn, BEAM_TURN_KEYS)) throw new TypeError("BEAM turn has an unexpected shape.");
        if (!Number.isSafeInteger(turn.id) || (turn.id as number) < 0) throw new TypeError("BEAM turn id must be a non-negative integer.");
        for (const key of ["index", "question_type", "time_anchor"]) {
          if (turn[key] !== null && typeof turn[key] !== "string") throw new TypeError(`BEAM turn ${key} must be text or null.`);
        }
        const anchor: string | null = turn.time_anchor === null || turn.time_anchor === "" ? null : text(turn.time_anchor, "time_anchor", 256);
        return { sourceId: turn.id as number, role: id(turn.role, "role"), content: text(turn.content, "content"), anchor };
      });
      const sessionDate = parsedTurns.find((turn) => turn.anchor !== null)?.anchor;
      if (sessionDate === undefined || sessionDate === null) throw new TypeError("BEAM session has no time anchor.");
      lastSessionDate = sessionDate;
      for (const [turnIndex, turn] of parsedTurns.entries()) {
        const turnId = `${sessionId}:${turnIndex}`;
        turns.push({ id: turnId, sessionId, sessionIndex, date: turn.anchor ?? sessionDate, speaker: turn.role, text: turn.content });
        const existing = bySourceId.get(turn.sourceId) ?? [];
        existing.push(turnId);
        bySourceId.set(turn.sourceId, existing);
      }
    }
    corpora.push({ id: corpusId, groupId: corpusId, turns });
    const byId = new Map(turns.map((turn) => [turn.id, turn]));
    const probing = object(row.probing_questions, "probing_questions");
    if (!hasExactKeys(probing, BEAM_QUESTION_TYPES)) throw new TypeError("BEAM probing questions must cover exactly the ten abilities.");
    for (const category of BEAM_QUESTION_TYPES) {
      for (const [index, rawQuestion] of array(probing[category], category, 16).entries()) {
        const question = object(rawQuestion, "probing question");
        const keys = Object.keys(question).sort();
        if (keys.length > 32 || !keys.includes("question") || !keys.includes("rubric")) throw new TypeError("BEAM probing question needs bounded keys with question and rubric.");
        const questionText = text(question.question, "question", 16_384);
        if (questionText.length === 0) throw new TypeError("BEAM question cannot be empty.");
        for (const nugget of array(question.rubric, "rubric", 64)) text(nugget, "rubric nugget", 4_096);
        if (question.difficulty !== undefined) text(question.difficulty, "difficulty", 64);
        const scorerSide: Record<string, unknown> = {};
        for (const key of keys) if (key !== "question") scorerSide[key] = question[key];
        const scorerJson = canonicalJson(scorerSide);
        if (Buffer.byteLength(scorerJson) > 262_144) throw new TypeError("BEAM probing question exceeds its byte bound.");
        const sourceIds = [...new Set(beamSourceChatIds(question.source_chat_ids))];
        const evidenceTurnIds = [...new Set(sourceIds.flatMap((sourceId) => bySourceId.get(sourceId) ?? []))];
        if (sourceIds.some((sourceId) => !bySourceId.has(sourceId))) throw new TypeError("BEAM source_chat_ids reference an unknown turn.");
        questions.push({ id: `${corpusId}:${category}:${index}`, corpusId, category: `beam:${category}`, question: questionText,
          questionDate: lastSessionDate, answer: scorerJson, unanswerable: category === "abstention",
          evidenceTurnIds, rawEvidenceTurnIds: sourceIds.map(String),
          evidenceSessionIds: [...new Set(evidenceTurnIds.map((turnId) => byId.get(turnId)!.sessionId))] });
      }
    }
  }
  return validateDataset({ corpora, questions });
}

export type BeamHistoryProvenance = Readonly<{
  corpusId: string; split: BeamSplit; rowIndex: number; conversationIdSha256: string;
  seedSha256: string; profileSha256: string; narrativesSha256: string; planSha256: string; userQuestionsSha256: string;
}>;

/**
 * Digest the author-side generation inputs of every BEAM history (seed, profile,
 * narratives, plan, planted user questions) without returning their text. The
 * exposure review joins related histories on these digests; nothing here is
 * offered to a memory system or a reader.
 */
export function parseBeamProvenance(value: unknown): readonly BeamHistoryProvenance[] {
  return beamRows(value).map(({ row, split, rowIndex, corpusId }) => ({
    corpusId, split, rowIndex, conversationIdSha256: sha256Hex(row.conversation_id as string),
    seedSha256: canonicalSha256(row.conversation_seed), profileSha256: canonicalSha256(row.user_profile),
    narrativesSha256: canonicalSha256(row.narratives), planSha256: canonicalSha256(row.conversation_plan),
    userQuestionsSha256: canonicalSha256(row.user_questions),
  }));
}

export function selectSplit(dataset: Dataset, split: Split, seed: number): Dataset {
  if (!Number.isSafeInteger(seed)) throw new TypeError("Seed must be an integer.");
  if (split === "all") return dataset;
  const groups = [...new Set(dataset.corpora.map((corpus) => corpus.groupId))]
    .sort((left, right) => sha256Hex(`${seed}:${left}`).localeCompare(sha256Hex(`${seed}:${right}`)));
  if (groups.length < 2) throw new RangeError("At least two independent groups are needed for a dev/test split.");
  const dev = new Set(groups.slice(0, Math.max(1, Math.floor(groups.length * 0.2))));
  const corpora = dataset.corpora.filter((corpus) => dev.has(corpus.groupId) === (split === "dev"));
  const ids = new Set(corpora.map((corpus) => corpus.id));
  return { corpora, questions: dataset.questions.filter((question) => ids.has(question.corpusId)) };
}

export function selectQuestions(dataset: Dataset, limit: number | undefined, seed: number): Dataset {
  if (limit === undefined) return dataset;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError("Question limit must be a positive integer.");
  if (limit >= dataset.questions.length) return dataset;
  const categories = [...new Set(dataset.questions.map((question) => question.category))].sort();
  const buckets = categories.map((category) => dataset.questions.filter((question) => question.category === category)
    .sort((left, right) => sha256Hex(`${seed}:${left.id}`).localeCompare(sha256Hex(`${seed}:${right.id}`))));
  const questions: Question[] = [];
  for (let index = 0; questions.length < limit; index += 1) {
    for (const bucket of buckets) {
      const question = bucket[index];
      if (question !== undefined && questions.length < limit) questions.push(question);
    }
  }
  const ids = new Set(questions.map((question) => question.corpusId));
  return { corpora: dataset.corpora.filter((corpus) => ids.has(corpus.id)), questions };
}
