import { sha256Hex, isPlainRecord } from "../../src/canonical";

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

export const DATASETS = {
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
