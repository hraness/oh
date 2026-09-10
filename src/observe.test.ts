import { describe, expect, test } from "bun:test";

import { canonicalSha256, sha256Hex } from "./canonical";
import { OhRecordCodecRegistry } from "./contract";
import { createKnowledgeGraphRecordV1, type KnowledgeGraphRecordV1 } from "./graph";
import {
  applySupersessionPolicyV1,
  isOhRecommendationQueryV1,
  makeOhObservationPromptV1,
  OH_OBSERVATION_INSTRUCTION_SHA256_V1,
  OH_OBSERVATION_INSTRUCTION_V1,
  OH_OBSERVATION_LIMITS_V1,
  OH_OBSERVATION_RECORD_CODEC_V1,
  OH_OBSERVATION_REJECTIONS_V1,
  observeOhV1,
  ohObservationActivityKeyV1,
  ohObservationKeyV1,
  parseOhObservationActivityValueV1,
  parseOhObservationRecordV1,
  parseOhObservationResponseV1,
  parseOhObservationSessionV1,
  parseOhObservationStatedAtInstantV1,
  parseOhObservationValueV1,
  renderOhObservationContextV1,
  resolveOhSupersessionV1,
  type OhObservationRecordV1,
  type OhObservationRejectionV1,
  type OhObserverV1,
} from "./observe";
import { OhSqliteStore } from "./sqlite/store";

type Turn = Readonly<{ id: string; sessionId: string; sessionIndex?: number; date: string; speaker: string; text: string }>;

const sessionOne: readonly Turn[] = [
  { id: "s1:0", sessionId: "s1", sessionIndex: 0, date: "2026/03/14 (Sat) 10:15", speaker: "user",
    text: "I started a pottery class at Kiln House three weeks ago and I go twice a week." },
  { id: "s1:1", sessionId: "s1", sessionIndex: 0, date: "2026/03/14 (Sat) 10:15", speaker: "assistant",
    text: "That sounds relaxing. A stoneware clay could suit hand-building." },
  { id: "s1:2", sessionId: "s1", sessionIndex: 0, date: "2026/03/14 (Sat) 10:15", speaker: "user",
    text: "I prefer oolong tea over coffee in the afternoon." },
];
const sessionTwo: readonly Turn[] = [
  { id: "s2:0", sessionId: "s2", sessionIndex: 1, date: "2026/03/28 (Sat) 09:00", speaker: "user",
    text: "Pottery update: I now go three times a week instead of twice." },
];
const sessionThree: readonly Turn[] = [
  { id: "s3:0", sessionId: "s3", sessionIndex: 2, date: "2026/03/21 (Sat) 18:30", speaker: "user",
    text: "I have cut pottery down to once a week because of work." },
];

function turnRecords(turns: readonly Turn[], offset: number): readonly KnowledgeGraphRecordV1[] {
  return turns.map((turn, index) => createKnowledgeGraphRecordV1({ dependencies: [],
    key: `edition:turn-${(offset + index).toString().padStart(5, "0")}`, kind: "edition", v: 1, value: { ...turn } }));
}

function openStore(): { keys: Record<"one" | "two" | "three", string[]>; store: OhSqliteStore } {
  const store = new OhSqliteStore({ path: ":memory:", spaceId: "observe" });
  const one = turnRecords(sessionOne, 0), two = turnRecords(sessionTwo, 3), three = turnRecords(sessionThree, 4);
  store.commit({ actorId: "agent.test", changes: [...one, ...two, ...three].map((record) => ({ kind: "put" as const, record, v: 1 as const })),
    expectedHead: store.head(), instant: "2026-04-01T00:00:00.000Z", operationId: "op_turns" });
  return { keys: { one: one.map((r) => r.key), two: two.map((r) => r.key), three: three.map((r) => r.key) }, store };
}

const responseOne = JSON.stringify({ observations: [
  { text: "user started a pottery class at Kiln House.", speaker: "user", kind: "event", eventAt: "2026-02-21",
    resolvedFrom: "three weeks ago", facet: "pottery-class-start", sources: ["t0"] },
  { text: "user goes to pottery class twice a week.", speaker: "user", kind: "fact", eventAt: null, resolvedFrom: null,
    facet: "pottery-frequency", sources: ["t0"] },
  { text: "assistant suggested a stoneware clay for hand-building.", speaker: "assistant", kind: "fact", eventAt: null,
    resolvedFrom: null, facet: null, sources: ["t1"] },
  { text: "user prefers oolong tea over coffee in the afternoon.", speaker: "user", kind: "preference", eventAt: null,
    resolvedFrom: null, facet: "afternoon-drink-preference", sources: ["t2"] },
] });
const responseTwo = JSON.stringify({ observations: [
  { text: "user's pottery attendance changed from twice a week to three times a week.", speaker: "user", kind: "update",
    eventAt: null, resolvedFrom: null, facet: "pottery-frequency", sources: ["t0"] },
] });
const responseThree = JSON.stringify({ observations: [
  { text: "user cut pottery attendance down to once a week because of work.", speaker: "user", kind: "update",
    eventAt: null, resolvedFrom: null, facet: "pottery-frequency", sources: ["t0"] },
] });

function observer(responses: Record<string, string>, calls: string[] = []): OhObserverV1 & { calls: string[] } {
  return { calls, modelId: "stub/observer-v1", observe(prompt) {
    calls.push(prompt.sessionSha256);
    const user = JSON.parse(prompt.messages[1].content) as { sessionDate: string };
    const response = responses[user.sessionDate];
    if (response === undefined) throw new Error("No stub response for the session date.");
    return response;
  } };
}

describe("frozen extraction instruction", () => {
  test("pins the committed instruction digest and stays corpus-general", () => {
    expect(String(OH_OBSERVATION_INSTRUCTION_SHA256_V1)).toBe("771ec3c8ec60ebbb4c048d6d2bec703f94543b2ba6e027c0165b44fc8db4d838");
    expect(sha256Hex(OH_OBSERVATION_INSTRUCTION_V1)).toBe(OH_OBSERVATION_INSTRUCTION_SHA256_V1);
    expect(OH_OBSERVATION_INSTRUCTION_V1).not.toMatch(/longmemeval|locomo|benchmark|gold|category|question/iu);
    expect(OH_OBSERVATION_INSTRUCTION_V1).toContain("changed from X to Y");
    expect(OH_OBSERVATION_INSTRUCTION_V1).toContain("resolvedFrom");
  });

  test("builds a question-blind prompt from session turns only", () => {
    const { keys, store } = openStore();
    const session = parseOhObservationSessionV1(keys.one.map((key) => store.get(key)!));
    const prompt = makeOhObservationPromptV1(session);
    expect(prompt.messages[0]).toEqual({ content: OH_OBSERVATION_INSTRUCTION_V1, role: "system" });
    expect(JSON.parse(prompt.messages[1].content)).toEqual({ sessionDate: "2026/03/14 (Sat) 10:15", turns: [
      { id: "t0", speaker: "user", text: sessionOne[0]!.text },
      { id: "t1", speaker: "assistant", text: sessionOne[1]!.text },
      { id: "t2", speaker: "user", text: sessionOne[2]!.text }] });
    expect(prompt.promptSha256).toBe(canonicalSha256(prompt.messages));
    expect(session.sessionSha256).toBe(canonicalSha256({ date: session.date, sessionId: "s1", sessionIndex: 0,
      turns: sessionOne.map((turn) => ({ speaker: turn.speaker, text: turn.text })), v: 1 }));
    expect(() => parseOhObservationSessionV1([...keys.one, ...keys.two].map((key) => store.get(key)!)))
      .toThrow("Session turns must share one session identity and date.");
    expect(() => parseOhObservationSessionV1([])).toThrow(RangeError);
    store.close();
  });
});

describe("bounded observation response parser", () => {
  const { keys, store } = openStore();
  const session = parseOhObservationSessionV1(keys.one.map((key) => store.get(key)!));
  const good = JSON.parse(responseOne) as { observations: Record<string, unknown>[] };
  const withFirst = (patch: Record<string, unknown>) =>
    JSON.stringify({ observations: [{ ...good.observations[0], ...patch }, ...good.observations.slice(1)] });

  test("accepts the exact shape, resolves aliases, and orders sources by key", () => {
    const parsed = parseOhObservationResponseV1(responseOne, session);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.observations).toHaveLength(4);
    expect(parsed.observations[0]).toEqual({ eventAt: "2026-02-21", facet: "pottery-class-start", kind: "event",
      resolvedFrom: "three weeks ago", sources: [{ key: keys.one[0]!, recordSha256: store.get(keys.one[0]!)!.recordSha256, v: 1 }],
      speaker: "user", text: "user started a pottery class at Kiln House." });
    const fenced = "```json\n" + responseOne + "\n```";
    expect(parseOhObservationResponseV1(fenced, session)).toEqual(parsed);
    expect(parseOhObservationResponseV1(JSON.stringify({ observations: [] }), session)).toEqual({ observations: [], ok: true });
  });

  test("rejects every malformed response with its reason code", () => {
    const matrix: Array<[OhObservationRejectionV1, unknown]> = [
      ["response-too-large", "x".repeat(OH_OBSERVATION_LIMITS_V1.responseBytes + 1)],
      ["response-too-large", 42],
      ["response-not-json", "not json"],
      ["response-not-json", "[".repeat(20) + "]".repeat(20)],
      ["response-duplicate-key", "{\"observations\":[],\"observations\":[]}"],
      ["response-shape", "{\"observations\":[],\"extra\":1}"],
      ["response-shape", "{\"observations\":{}}"],
      ["observation-count", JSON.stringify({ observations: Array.from({ length: 49 }, () => good.observations[0]) })],
      ["observation-shape", JSON.stringify({ observations: [{ ...good.observations[0], extra: 1 }] })],
      ["observation-shape", JSON.stringify({ observations: ["text"] })],
      ["text", withFirst({ text: "" })],
      ["text", withFirst({ text: "a".repeat(OH_OBSERVATION_LIMITS_V1.textBytes + 1) })],
      ["text", withFirst({ text: "two\nlines" })],
      ["speaker", withFirst({ speaker: 7 })],
      ["speaker-attribution", withFirst({ speaker: "assistant" })],
      ["kind", withFirst({ kind: "opinion" })],
      ["event-at", withFirst({ eventAt: "2026-02-30" })],
      ["event-at", withFirst({ eventAt: "21/02/2026" })],
      ["resolved-from", withFirst({ resolvedFrom: null })],
      ["resolved-from", withFirst({ eventAt: null })],
      ["facet", withFirst({ facet: "Pottery Class" })],
      ["facet", withFirst({ facet: "a".repeat(OH_OBSERVATION_LIMITS_V1.facetChars + 1) })],
      ["sources", withFirst({ sources: [] })],
      ["sources", withFirst({ sources: ["t0", "t0"] })],
      ["sources", withFirst({ sources: "t0" })],
      ["source-alias", withFirst({ sources: ["t9"] })],
      ["source-alias", withFirst({ sources: ["edition:turn-00000"] })],
      ["duplicate-text", JSON.stringify({ observations: [good.observations[0], good.observations[0]] })],
    ];
    for (const [rejection, raw] of matrix) {
      const parsed = parseOhObservationResponseV1(raw, session);
      expect({ raw: String(raw).slice(0, 40), rejection: parsed.ok ? "accepted" : parsed.rejection })
        .toEqual({ raw: String(raw).slice(0, 40), rejection });
      expect(OH_OBSERVATION_REJECTIONS_V1).toContain(rejection);
    }
    const covered = new Set(matrix.map(([rejection]) => rejection));
    expect([...OH_OBSERVATION_REJECTIONS_V1].filter((code) => !covered.has(code))).toEqual([]);
  });
});

describe("observation profile codec", () => {
  test("parses only the exact profile and registers as an edition codec", () => {
    const value = { eventAt: null, facet: "tea", format: "oh.observation.v1", kind: "preference", orderingConflict: false,
      resolvedFrom: null, sources: [{ key: "edition:turn-00000", recordSha256: "a".repeat(64), v: 1 }], speaker: "user",
      statedAt: "2026-01-01", supersedes: null, text: "user prefers tea.", v: 1 };
    expect(parseOhObservationValueV1(value)).toEqual(value as never);
    expect(parseOhObservationValueV1({ ...value, extra: true })).toBeNull();
    expect(parseOhObservationValueV1({ ...value, orderingConflict: true })).toBeNull();
    expect(parseOhObservationValueV1({ ...value, supersedes: "edition:turn-00000" })).toBeNull();
    expect(parseOhObservationValueV1({ ...value, supersedes: "edition:obs-x-000", orderingConflict: true })).not.toBeNull();
    expect(parseOhObservationValueV1({ ...value, eventAt: "2026-01-01" })).toBeNull();
    expect(parseOhObservationValueV1({ ...value, sources: [] })).toBeNull();
    expect(parseOhObservationValueV1({ ...value, sources: [value.sources[0], value.sources[0]] })).toBeNull();
    const registry = new OhRecordCodecRegistry().register(OH_OBSERVATION_RECORD_CODEC_V1);
    expect(registry.parseRequired("edition", value)).toEqual(value as never);
    expect(registry.parseRequired("edition", { title: "page" })).toBeNull();
    expect(parseOhObservationRecordV1(createKnowledgeGraphRecordV1({ dependencies: [], key: "edition:obs-a-000", kind: "edition",
      v: 1, value }))).toBeNull();
    expect(parseOhObservationRecordV1(createKnowledgeGraphRecordV1({ dependencies: ["edition:turn-00000"], key: "edition:obs-a-000",
      kind: "edition", v: 1, value }))?.value).toEqual(value as never);
  });

  test("reads calendar dates out of free-form statement stamps", () => {
    expect(parseOhObservationStatedAtInstantV1("2026/03/14 (Sat) 10:15")).toBe(Date.parse("2026-03-14T10:15:00.000Z"));
    expect(parseOhObservationStatedAtInstantV1("2026-03-14")).toBe(Date.parse("2026-03-14T00:00:00.000Z"));
    expect(parseOhObservationStatedAtInstantV1("Saturday")).toBeNull();
    expect(parseOhObservationStatedAtInstantV1("2026/02/30 12:00")).toBeNull();
  });
});

describe("observeOhV1", () => {
  test("commits observations as edition records with provenance and one receipt, idempotently", async () => {
    const { keys, store } = openStore();
    const stub = observer({ "2026/03/14 (Sat) 10:15": responseOne });
    const result = await observeOhV1({ actorId: "agent.observe", instant: "2026-04-02T00:00:00.000Z", observer: stub,
      sessionRecordKeys: keys.one, store });
    expect(result.status).toBe("committed");
    if (result.status !== "committed") return;
    expect(result.observationKeys).toHaveLength(4);
    expect(result.operation?.changes).toHaveLength(5);
    const activity = store.get(result.activityKey)!;
    expect(activity.kind).toBe("activity");
    expect(activity.dependencies).toEqual(keys.one);
    const receipt = parseOhObservationActivityValueV1(activity.value)!;
    expect(receipt).toMatchObject({ instructionSha256: OH_OBSERVATION_INSTRUCTION_SHA256_V1, modelId: "stub/observer-v1",
      observationCount: 4, observedAt: "2026-04-02T00:00:00.000Z", responseSha256: sha256Hex(responseOne), sessionIndex: 0,
      sessionSha256: result.sessionSha256 });
    expect(receipt.sources).toEqual(keys.one.map((key) => ({ key, recordSha256: store.get(key)!.recordSha256, v: 1 })));
    for (const [index, key] of result.observationKeys.entries()) {
      expect(key).toBe(ohObservationKeyV1(result.sessionSha256, index));
      const record = parseOhObservationRecordV1(store.get(key))!;
      expect(record.dependencies[0]).toBe(ohObservationActivityKeyV1(result.sessionSha256));
      for (const source of record.value.sources) {
        expect(record.dependencies).toContain(source.key);
        expect(store.get(source.key)!.recordSha256).toBe(source.recordSha256);
      }
      expect(record.value.statedAt).toBe("2026/03/14 (Sat) 10:15");
      expect(record.value.supersedes).toBeNull();
    }
    expect(parseOhObservationRecordV1(store.get(result.observationKeys[0]!))!.value.eventAt).toBe("2026-02-21");
    const again = await observeOhV1({ actorId: "agent.observe", instant: "2026-04-03T00:00:00.000Z", observer: stub,
      sessionRecordKeys: keys.one, store });
    expect(again).toEqual({ activityKey: result.activityKey, instructionSha256: OH_OBSERVATION_INSTRUCTION_SHA256_V1,
      observationKeys: result.observationKeys, operation: null, responseSha256: sha256Hex(responseOne),
      sessionSha256: result.sessionSha256, status: "existing" });
    expect(stub.calls).toHaveLength(1);
    expect(store.head().sequence).toBe(2);
    store.close();
  });

  test("commits nothing for a rejected response and reports the reason", async () => {
    const { keys, store } = openStore();
    const stub = observer({ "2026/03/14 (Sat) 10:15": "{\"observations\":[{\"text\":\"x\"}]}" });
    const result = await observeOhV1({ actorId: "agent.observe", instant: "2026-04-02T00:00:00.000Z", observer: stub,
      sessionRecordKeys: keys.one, store });
    expect(result).toMatchObject({ index: 0, rejection: "observation-shape", status: "rejected" });
    expect(store.head().sequence).toBe(1);
    expect(store.get(ohObservationActivityKeyV1(result.sessionSha256))).toBeNull();
    store.close();
  });

  test("links supersession by facet and speaker and records ordering conflicts without picking", async () => {
    const { keys, store } = openStore();
    const stub = observer({ "2026/03/14 (Sat) 10:15": responseOne, "2026/03/28 (Sat) 09:00": responseTwo,
      "2026/03/21 (Sat) 18:30": responseThree });
    const common = { actorId: "agent.observe", observer: stub, store, supersession: true } as const;
    const first = await observeOhV1({ ...common, instant: "2026-04-02T00:00:00.000Z", sessionRecordKeys: keys.one });
    const second = await observeOhV1({ ...common, instant: "2026-04-02T00:00:01.000Z", sessionRecordKeys: keys.two });
    const third = await observeOhV1({ ...common, instant: "2026-04-02T00:00:02.000Z", sessionRecordKeys: keys.three });
    if (first.status !== "committed" || second.status !== "committed" || third.status !== "committed") throw new Error("commit");
    const frequencyOne = first.observationKeys[1]!, frequencyTwo = second.observationKeys[0]!, frequencyThree = third.observationKeys[0]!;
    const two = parseOhObservationRecordV1(store.get(frequencyTwo))!;
    expect(two.value).toMatchObject({ orderingConflict: false, supersedes: frequencyOne });
    expect(two.dependencies).toContain(frequencyOne);
    // Session three was ingested after session two but its statement stamp is earlier: conflict recorded, both kept.
    const three = parseOhObservationRecordV1(store.get(frequencyThree))!;
    expect(three.value).toMatchObject({ orderingConflict: true, supersedes: frequencyTwo });
    expect(parseOhObservationRecordV1(store.get(first.observationKeys[0]!))!.value.supersedes).toBeNull();
    expect(parseOhObservationRecordV1(store.get(first.observationKeys[3]!))!.value.supersedes).toBeNull();
    // The head of the chain is the unsuperseded observation; a fourth statement links to it.
    expect(resolveOhSupersessionV1(store, { facet: "pottery-frequency", speaker: "user", statedAt: "2026/04/01 (Wed) 08:00" }))
      .toEqual({ candidatesTruncated: false, orderingConflict: false, supersedes: frequencyThree });
    expect(resolveOhSupersessionV1(store, { facet: "pottery-frequency", speaker: "assistant", statedAt: "2026/04/01 (Wed) 08:00" }))
      .toEqual({ candidatesTruncated: false, orderingConflict: false, supersedes: null });
    expect(resolveOhSupersessionV1(store, { facet: null, speaker: "user", statedAt: "2026/04/01" }))
      .toEqual({ candidatesTruncated: false, orderingConflict: false, supersedes: null });
    store.close();
  });

  test("applySupersessionPolicyV1 links already committed observations and is a no-op when linked", async () => {
    const { keys, store } = openStore();
    const stub = observer({ "2026/03/14 (Sat) 10:15": responseOne, "2026/03/28 (Sat) 09:00": responseTwo });
    const first = await observeOhV1({ actorId: "agent.observe", instant: "2026-04-02T00:00:00.000Z", observer: stub,
      sessionRecordKeys: keys.one, store });
    const second = await observeOhV1({ actorId: "agent.observe", instant: "2026-04-02T00:00:01.000Z", observer: stub,
      sessionRecordKeys: keys.two, store });
    if (first.status !== "committed" || second.status !== "committed") throw new Error("commit");
    const before = store.get(second.observationKeys[0]!)!;
    expect(parseOhObservationRecordV1(before)!.value.supersedes).toBeNull();
    const applied = applySupersessionPolicyV1({ actorId: "agent.policy", instant: "2026-04-02T00:00:02.000Z",
      observationKeys: second.observationKeys, store });
    expect(applied.links).toEqual([{ candidatesTruncated: false, key: second.observationKeys[0]!, orderingConflict: false,
      supersedes: first.observationKeys[1]! }]);
    expect(applied.operation?.changes).toHaveLength(1);
    const after = parseOhObservationRecordV1(store.get(second.observationKeys[0]!))!;
    expect(after.value.supersedes).toBe(first.observationKeys[1]!);
    expect(after.recordSha256).not.toBe(before.recordSha256);
    expect(after.dependencies).toContain(first.observationKeys[1]!);
    expect(applySupersessionPolicyV1({ actorId: "agent.policy", instant: "2026-04-02T00:00:03.000Z",
      observationKeys: second.observationKeys, store }).operation).toBeNull();
    expect(() => applySupersessionPolicyV1({ actorId: "agent.policy", instant: "2026-04-02T00:00:03.000Z",
      observationKeys: [keys.one[0]!], store })).toThrow("Not a current observation record");
    store.close();
  });

  test("rejects stale or foreign session inputs", async () => {
    const { keys, store } = openStore();
    const stub = observer({});
    await expect(observeOhV1({ actorId: "agent.observe", instant: "2026-04-02T00:00:00.000Z", observer: stub,
      sessionRecordKeys: ["edition:missing"], store })).rejects.toThrow("Missing session turn record");
    await expect(observeOhV1({ actorId: "agent observe", instant: "2026-04-02T00:00:00.000Z", observer: stub,
      sessionRecordKeys: keys.one, store })).rejects.toThrow("Invalid observe input.");
    store.commit({ actorId: "agent.test", changes: [{ kind: "put", record: createKnowledgeGraphRecordV1({ dependencies: [],
      key: "edition:page", kind: "edition", v: 1, value: { title: "page" } }), v: 1 }], expectedHead: store.head(),
      instant: "2026-04-01T00:00:01.000Z", operationId: "op_page" });
    await expect(observeOhV1({ actorId: "agent.observe", instant: "2026-04-02T00:00:00.000Z", observer: stub,
      sessionRecordKeys: ["edition:page"], store })).rejects.toThrow("Invalid session turn record");
    store.close();
  });
});

describe("derived-first rendering", () => {
  function records(store: OhSqliteStore, keys: readonly string[]): OhObservationRecordV1[] {
    return keys.map((key) => parseOhObservationRecordV1(store.get(key))!);
  }

  test("renders dated Memory lines ahead of raw turns, with preference and supersession markers", async () => {
    const { keys, store } = openStore();
    const stub = observer({ "2026/03/14 (Sat) 10:15": responseOne, "2026/03/28 (Sat) 09:00": responseTwo,
      "2026/03/21 (Sat) 18:30": responseThree });
    const common = { actorId: "agent.observe", observer: stub, store, supersession: true } as const;
    const first = await observeOhV1({ ...common, instant: "2026-04-02T00:00:00.000Z", sessionRecordKeys: keys.one });
    const second = await observeOhV1({ ...common, instant: "2026-04-02T00:00:01.000Z", sessionRecordKeys: keys.two });
    const third = await observeOhV1({ ...common, instant: "2026-04-02T00:00:02.000Z", sessionRecordKeys: keys.three });
    if (first.status !== "committed" || second.status !== "committed" || third.status !== "committed") throw new Error("commit");
    const observations = records(store, [...first.observationKeys, ...second.observationKeys, ...third.observationKeys]);
    const turns = ["[s1:0] [2026/03/14 (Sat) 10:15] user: raw turn one", "[s2:0] [2026/03/28 (Sat) 09:00] user: raw turn two"];

    const plain = renderOhObservationContextV1({ observations, query: "How often does the user go to pottery class?", turns });
    const lines = plain.split("\n");
    expect(lines[0]).toBe("Memory: [2026/03/14 (Sat) 10:15] user (event): user started a pottery class at Kiln House."
      + " [event 2026-02-21, from \"three weeks ago\"]");
    expect(lines[1]).toBe("Memory: [2026/03/14 (Sat) 10:15] user (fact): user goes to pottery class twice a week."
      + " (superseded on 2026/03/28 (Sat) 09:00)");
    expect(lines[4]).toBe("Memory: [2026/03/28 (Sat) 09:00] user (update): user's pottery attendance changed from twice a week"
      + " to three times a week. (superseded on 2026/03/21 (Sat) 18:30; ordering conflict, stated 2026/03/28 (Sat) 09:00"
      + " vs 2026/03/21 (Sat) 18:30, both kept)");
    expect(lines[5]).toBe("Memory: [2026/03/21 (Sat) 18:30] user (update): user cut pottery attendance down to once a week"
      + " because of work. (supersedes a later-stamped statement; both dates kept)");
    expect(plain.endsWith(`\n\n${turns[0]}\n\n${turns[1]}`)).toBe(true);
    expect(plain.indexOf("Memory:")).toBeLessThan(plain.indexOf("[s1:0]"));
    expect(plain).not.toContain("Remembered preferences");

    const recommendation = renderOhObservationContextV1({ observations, query: "Can you recommend an afternoon drink for me?", turns });
    expect(recommendation.startsWith("Remembered preferences (afternoon-drink-preference):\n"
      + "Memory: [2026/03/14 (Sat) 10:15] user (preference): user prefers oolong tea over coffee in the afternoon.\n\n")).toBe(true);
    expect(recommendation.split("user (preference)")).toHaveLength(2);
    expect(renderOhObservationContextV1({ observations: [], query: "recommend", turns })).toBe(turns.join("\n\n"));
    expect(() => renderOhObservationContextV1({ observations: [store.get(keys.one[0]!) as never], query: "x", turns }))
      .toThrow("Only current observation records render.");
    store.close();
  });

  test("detects recommendation queries with a bounded lexical pattern", () => {
    expect(isOhRecommendationQueryV1("Can you recommend a podcast?")).toBe(true);
    expect(isOhRecommendationQueryV1("What should I cook tonight?")).toBe(true);
    expect(isOhRecommendationQueryV1("Any good ideas for a weekend trip?")).toBe(true);
    expect(isOhRecommendationQueryV1("How many times did I visit the gym?")).toBe(false);
    expect(isOhRecommendationQueryV1("r".repeat(20_000))).toBe(false);
  });
});
