import { expect, test } from "bun:test";
import { EVOLUTION_PROFILES, EVOLUTION_SESSION_DIGEST_PROFILE_ID, makeEvolutionRequest } from "../scripts/benchmarks/evolution-model";
import { OH_SESSION_DIGEST_LIMITS_V1, OH_SESSION_DIGEST_RESPONSE_FORMAT_V1, generateOhDigestedAuthorLogContextV1,
  prepareOhSessionDigestsV1, renderOhSessionDigestsV1, resolveOhSessionDigestV1 } from "../scripts/benchmarks/oh-session-digest";

const turn = (id: string, sessionId: string, date: string, speaker: string, text: string) => ({ id, sessionId, date, speaker, text });
const corpus = { id: "c", groupId: "g", turns: [
  turn("s0:0", "s0", "2024-01-05T00:00:00.000Z", "user", "Set up Express 4.18 on port 3000."),
  turn("s0:1", "s0", "2024-01-05T00:00:00.000Z", "assistant", "a".repeat(2_000)),
  turn("s1:0", "s1", "2024-02-03T00:00:00.000Z", "user", "Add Redis caching for sessions."),
  turn("s2:0", "s2", "2024-03-01T00:00:00.000Z", "user", "Plan the migration script."),
] };
const answer = (sessionId: string, theme: string, topics: string[]) => JSON.stringify({ sessionId, theme, topics });

test("one request per session holds only that session's text, clips assistant turns and fits the extractor profile", () => {
  const plans = prepareOhSessionDigestsV1(corpus);
  expect(plans.map(plan => [plan.sessionId, plan.ordinal, plan.date])).toEqual([["s0", 0, "2024-01-05T00:00:00.000Z"],
    ["s1", 1, "2024-02-03T00:00:00.000Z"], ["s2", 2, "2024-03-01T00:00:00.000Z"]]);
  const user = plans[0]!.messages[1]!.content;
  expect(user).toContain("Express 4.18");
  expect(user).not.toContain("Redis");
  expect(user).toContain(`[assistant, clipped] ${"a".repeat(OH_SESSION_DIGEST_LIMITS_V1.assistantTurnBytes)}…`);
  expect(user).not.toContain("a".repeat(OH_SESSION_DIGEST_LIMITS_V1.assistantTurnBytes + 1));
  expect(prepareOhSessionDigestsV1(structuredClone(corpus))).toEqual(plans);
  const request = makeEvolutionRequest(EVOLUTION_SESSION_DIGEST_PROFILE_ID, plans[0]!.messages);
  expect(request.body.response_format).toEqual(OH_SESSION_DIGEST_RESPONSE_FORMAT_V1);
  expect(EVOLUTION_PROFILES[EVOLUTION_SESSION_DIGEST_PROFILE_ID].settings).toEqual({ reasoning: { effort: "low" } });
});

test("answers must name their own session; long fields are clipped, not dropped", () => {
  const [plan] = prepareOhSessionDigestsV1(corpus);
  expect(() => resolveOhSessionDigestV1(plan!, answer("s1", "Theme.", []))).toThrow("identity");
  expect(() => resolveOhSessionDigestV1(plan!, JSON.stringify({ sessionId: "s0", theme: "", topics: [] }))).toThrow("theme");
  expect(() => resolveOhSessionDigestV1(plan!, JSON.stringify({ sessionId: "s0", theme: "T", topics: [1] }))).toThrow("theme");
  expect(() => resolveOhSessionDigestV1(plan!, JSON.stringify({ sessionId: "s0", theme: "T", topics: [], extra: 1 }))).toThrow("identity");
  const digest = resolveOhSessionDigestV1(plan!, answer("s0", "word ".repeat(200), Array.from({ length: 9 }, (_, index) => `topic ${index}\n`)));
  expect(Buffer.byteLength(digest.theme)).toBeLessThanOrEqual(OH_SESSION_DIGEST_LIMITS_V1.themeBytes + 3);
  expect(digest.topics).toEqual(["topic 0", "topic 1", "topic 2", "topic 3", "topic 4", "topic 5"]);
  expect(Object.isFrozen(digest.topics)).toBeTrue();
});

test("the timeline hides sessions after the question date and the log keeps the remaining budget", async () => {
  const plans = prepareOhSessionDigestsV1(corpus);
  const digests = plans.map(plan => resolveOhSessionDigestV1(plan, answer(plan.sessionId, `Theme ${plan.sessionId}.`, [`topic ${plan.sessionId}`])));
  const timeline = renderOhSessionDigestsV1(digests.toReversed(), "2024-02-03T00:00:00.000Z");
  expect(timeline.sessions).toEqual(["s0", "s1"]);
  expect(timeline.text).toContain("## Session 1 · 2024-01-05\nTheme: Theme s0.\n- topic s0");
  expect(timeline.text).not.toContain("s2");
  expect(renderOhSessionDigestsV1(digests, "2023-01-01T00:00:00.000Z").bytes).toBe(0);
  const seen: number[] = [];
  const generate = async (_question: string, options: { budgetBytes?: number }) => { seen.push(options.budgetBytes!); return { rendering: { context: "LOG" } }; };
  const result = await generateOhDigestedAuthorLogContextV1(generate, "q", { asOf: "2024-02-03T00:00:00.000Z", budgetBytes: 10_000,
    retrievedBytes: 4_000, logReserveBytes: 1_000 }, digests);
  expect(seen).toEqual([10_000 - timeline.bytes - 2]);
  expect(result.context).toBe(`${timeline.text}\n\nLOG`);
  expect(result.contextBytes).toBeLessThanOrEqual(10_000 - seen[0]! + 3);
  await expect(generateOhDigestedAuthorLogContextV1(generate, "q", { asOf: null, budgetBytes: 4_100, retrievedBytes: 4_000, logReserveBytes: 0 }, digests))
    .rejects.toThrow("too little budget");
  const empty = await generateOhDigestedAuthorLogContextV1(generate, "q", { asOf: "2023-01-01T00:00:00.000Z", budgetBytes: 5_000 }, digests);
  expect(empty.context).toBe("LOG");
  expect(seen.at(-1)).toBe(5_000);
});
