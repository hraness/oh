import { canonicalSha256, isPlainRecord, parseCanonicalInstantV1 } from "../../src/canonical";
import type { Message } from "./model";
import type { Corpus } from "./datasets";
import type { OhAuthorLogContextRunOptionsV1 } from "./oh-author-log-context";

/** Opt-in session digests: one short, dated, label-free summary per conversation session, written by an extractor from
 * that session's text alone. The digests sit above the author log as a timeline, so a reader can see what every session
 * was about even when the ranked log is partial. The log keeps its own budget minus the digest bytes; nothing else changes. */
export const OH_SESSION_DIGEST_PROTOCOL_V1 = "oh.session-digest.v1" as const;
export const OH_SESSION_DIGEST_LIMITS_V1 = Object.freeze({ sessions: 64, assistantTurnBytes: 600, inputBytes: 262_144,
  themeBytes: 240, topics: 6, topicBytes: 200, answerBytes: 16_384 });

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
const string = { type: "string" } as const;
export const OH_SESSION_DIGEST_RESPONSE_FORMAT_V1 = freeze({ type: "json_schema" as const, json_schema: { name: "oh_session_digest_v1",
  strict: true as const, schema: { type: "object" as const, additionalProperties: false as const, required: ["sessionId", "theme", "topics"],
    properties: { sessionId: string, theme: string, topics: { type: "array" as const, items: string } } } } });

const INSTRUCTIONS = [
  "You write a dated digest of one conversation session between a user and an assistant.",
  "The user's messages are complete; the assistant's replies are clipped and only show what was being answered.",
  "Return JSON with: sessionId (copied exactly), theme (one sentence naming what the user worked on in this session),",
  "and topics (at most 6 short items, in the order the user raised them, each naming one concrete thing the user asked about,",
  "reported, decided or planned, with the names, numbers, versions and dates as the user stated them).",
  "Use only this session's text. Do not add advice, evaluation or anything the user did not say.",
].join(" ");

const clipBytes = (text: string, max: number) => {
  if (Buffer.byteLength(text) <= max) return text;
  let clipped = Buffer.from(text).subarray(0, max).toString("utf8").replace(/�+$/u, "");
  const space = clipped.lastIndexOf(" ");
  if (space > max / 2) clipped = clipped.slice(0, space);
  return `${clipped}…`;
};
const oneLine = (text: string) => text.replace(/\s+/gu, " ").trim();

export type OhSessionDigestPlanV1 = Readonly<{ protocol: typeof OH_SESSION_DIGEST_PROTOCOL_V1; corpusId: string; sessionId: string;
  ordinal: number; date: string; messages: readonly Message[]; inputSha256: string }>;
export type OhSessionDigestV1 = Readonly<{ protocol: typeof OH_SESSION_DIGEST_PROTOCOL_V1; corpusId: string; sessionId: string;
  ordinal: number; date: string; theme: string; topics: readonly string[]; inputSha256: string }>;

/** One extraction request per session, in corpus session order. Only turn text, speaker and date enter the request. */
export function prepareOhSessionDigestsV1(corpus: Corpus): readonly OhSessionDigestPlanV1[] {
  const sessions = new Map<string, Corpus["turns"][number][]>();
  for (const turn of corpus.turns) { const members = sessions.get(turn.sessionId) ?? []; members.push(turn); sessions.set(turn.sessionId, members); }
  if (sessions.size > OH_SESSION_DIGEST_LIMITS_V1.sessions) throw new RangeError("Session digest: too many sessions.");
  return freeze([...sessions.entries()].map(([sessionId, turns], ordinal) => {
    const date = turns[0]!.date;
    if (parseCanonicalInstantV1(date) === null) throw new TypeError("Session digest: canonical session date required.");
    const body = turns.map(turn => turn.speaker === "user" ? `[user] ${turn.text}`
      : `[assistant, clipped] ${clipBytes(turn.text, OH_SESSION_DIGEST_LIMITS_V1.assistantTurnBytes)}`).join("\n\n");
    const user = `sessionId: ${sessionId}\nsession date: ${date.slice(0, 10)}\n\n${body}`;
    if (Buffer.byteLength(user) > OH_SESSION_DIGEST_LIMITS_V1.inputBytes) throw new RangeError("Session digest: session input bound exceeded.");
    const messages: Message[] = [{ role: "system", content: INSTRUCTIONS }, { role: "user", content: user }];
    return { protocol: OH_SESSION_DIGEST_PROTOCOL_V1, corpusId: corpus.id, sessionId, ordinal, date, messages,
      inputSha256: canonicalSha256({ protocol: OH_SESSION_DIGEST_PROTOCOL_V1, messages }) };
  }));
}

/** Parse the extractor answer. Shape and identity are strict; lengths are clipped deterministically rather than rejected,
 * so one verbose answer cannot remove a session from the timeline. */
export function resolveOhSessionDigestV1(plan: OhSessionDigestPlanV1, answer: string): OhSessionDigestV1 {
  if (typeof answer !== "string" || Buffer.byteLength(answer) > OH_SESSION_DIGEST_LIMITS_V1.answerBytes) throw new TypeError("Session digest: bounded answer required.");
  const value: unknown = JSON.parse(answer);
  if (!isPlainRecord(value) || Object.keys(value).length !== 3 || value.sessionId !== plan.sessionId) throw new TypeError("Session digest: session identity mismatch.");
  if (typeof value.theme !== "string" || oneLine(value.theme).length === 0 || !Array.isArray(value.topics)
    || value.topics.some(topic => typeof topic !== "string")) throw new TypeError("Session digest: theme and topics required.");
  const topics = (value.topics as string[]).map(oneLine).filter(topic => topic.length > 0).slice(0, OH_SESSION_DIGEST_LIMITS_V1.topics)
    .map(topic => clipBytes(topic, OH_SESSION_DIGEST_LIMITS_V1.topicBytes));
  return freeze({ protocol: OH_SESSION_DIGEST_PROTOCOL_V1, corpusId: plan.corpusId, sessionId: plan.sessionId, ordinal: plan.ordinal,
    date: plan.date, theme: clipBytes(oneLine(value.theme), OH_SESSION_DIGEST_LIMITS_V1.themeBytes), topics, inputSha256: plan.inputSha256 });
}

/** Timeline of the sessions dated at or before `asOf`, in date then session order. */
export function renderOhSessionDigestsV1(digests: readonly OhSessionDigestV1[], asOf: string | null) {
  const visible = digests.filter(digest => asOf === null || digest.date <= asOf)
    .toSorted((a, b) => a.date.localeCompare(b.date) || a.ordinal - b.ordinal);
  if (visible.length === 0) return freeze({ text: "", bytes: 0, sessions: [] as string[] });
  const text = ["# Session timeline",
    "One machine-written digest per conversation session, oldest first. Use it to see what each session covered and in what order;",
    "check exact details against the log below.", "",
    ...visible.map((digest, index) => [`## Session ${index + 1} · ${digest.date.slice(0, 10)}`, `Theme: ${digest.theme}`,
      ...digest.topics.map(topic => `- ${topic}`)].join("\n"))].join("\n");
  return freeze({ text, bytes: Buffer.byteLength(text), sessions: visible.map(digest => digest.sessionId) });
}

/** Timeline first, then the author-log context rendered in the remaining bytes of the same budget. */
export async function generateOhDigestedAuthorLogContextV1<R extends Readonly<{ rendering: Readonly<{ context: string }> }>>(
  generate: (question: string, options: OhAuthorLogContextRunOptionsV1) => Promise<R>, question: string,
  options: OhAuthorLogContextRunOptionsV1 & Readonly<{ budgetBytes: number }>, digests: readonly OhSessionDigestV1[]) {
  const timeline = renderOhSessionDigestsV1(digests, options.asOf), separator = timeline.bytes === 0 ? 0 : 2;
  const budgetBytes = options.budgetBytes - timeline.bytes - separator;
  if (budgetBytes < (options.logReserveBytes ?? 0) || budgetBytes < (options.retrievedBytes ?? 0)) throw new RangeError("Session digest: timeline leaves too little budget.");
  const run = await generate(question, { ...options, budgetBytes });
  const context = timeline.bytes === 0 ? run.rendering.context : `${timeline.text}\n\n${run.rendering.context}`;
  return Object.freeze({ protocol: OH_SESSION_DIGEST_PROTOCOL_V1, context, contextBytes: Buffer.byteLength(context), timeline, run });
}
