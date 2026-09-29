import { expect, test } from "bun:test";
import { EVOLUTION_PROFILES, EVOLUTION_SESSION_NOTES_PROFILE_ID, makeEvolutionRequest } from "../scripts/benchmarks/evolution-model";
import { OH_SESSION_NOTES_LIMITS_V1, OH_SESSION_NOTES_NONE_V1, generateOhNotedAuthorLogContextV1, prepareOhSessionNotesV1,
  renderOhSessionNotesV1, resolveOhSessionNoteV1, splitOhAuthorLogSessionsV1 } from "../scripts/benchmarks/oh-session-notes";

const context = [
  "Question date: 2024/03/10 (Sun).", "", "# Partial log of user messages", "",
  "## Session [\"s0\",0]: 2024/01/05 (Fri), 65 days before the question", "[edition:a] user: Set up Express 4.18 on port 3000.", "",
  "## Session [\"s1\",1]: 2024/02/03 (Sat), 36 days before the question", "",
  "## Session [\"s2\",2]: 2024/03/01 (Fri), 9 days before the question", "[edition:b] user: Add Redis caching for sessions.",
].join("\n");
const question = { question: "In what order did I bring up parts of my backend?", questionDate: "2024-03-10T00:00:00.000Z" };

test("the context splits at its session headers and empty sessions are skipped", () => {
  const parts = splitOhAuthorLogSessionsV1(context);
  expect(parts.map(part => part.header)).toEqual(["## Session [\"s0\",0]: 2024/01/05 (Fri), 65 days before the question",
    "## Session [\"s2\",2]: 2024/03/01 (Fri), 9 days before the question"]);
  expect(parts[0]!.body).toBe("[edition:a] user: Set up Express 4.18 on port 3000.");
  expect(splitOhAuthorLogSessionsV1("no sessions here")).toEqual([]);
});

test("one request per session holds only the question and that session's text, and fits the extractor profile", () => {
  const plans = prepareOhSessionNotesV1(question, context);
  expect(plans.map(plan => plan.ordinal)).toEqual([0, 1]);
  const user = plans[0]!.messages[1]!.content;
  expect(user).toContain("Question: In what order did I bring up parts of my backend?");
  expect(user).toContain("Express 4.18");
  expect(user).not.toContain("Redis");
  expect(prepareOhSessionNotesV1(structuredClone(question), context)).toEqual(plans);
  expect(prepareOhSessionNotesV1({ ...question, question: "Other?" }, context)[0]!.inputSha256).not.toBe(plans[0]!.inputSha256);
  expect(() => prepareOhSessionNotesV1({ ...question, question: " " }, context)).toThrow("question required");
  const request = makeEvolutionRequest(EVOLUTION_SESSION_NOTES_PROFILE_ID, plans[0]!.messages);
  expect(request.body.response_format).toBeUndefined();
  expect(EVOLUTION_PROFILES[EVOLUTION_SESSION_NOTES_PROFILE_ID].settings).toEqual({ reasoning: { effort: "low" } });
});

test("answers are normalized, clipped rather than dropped, and an irrelevant session keeps its header", () => {
  const [first, second] = prepareOhSessionNotesV1(question, context);
  expect(() => resolveOhSessionNoteV1(first!, " \n ")).toThrow("empty answer");
  const note = resolveOhSessionNoteV1(first!, "Theme: API server setup\n\n-   Express 4.18 on port 3000");
  expect(note.note).toBe("Theme: API server setup\n- Express 4.18 on port 3000");
  expect(note.relevant).toBeTrue();
  expect(Buffer.byteLength(resolveOhSessionNoteV1(first!, `Theme: ${"word ".repeat(400)}`).note)).toBeLessThanOrEqual(OH_SESSION_NOTES_LIMITS_V1.noteBytes + 3);
  const none = resolveOhSessionNoteV1(second!, "nothing relevant");
  expect(none).toMatchObject({ relevant: false, note: OH_SESSION_NOTES_NONE_V1 });
  const rendered = renderOhSessionNotesV1([none, note]);
  expect(rendered.text).toContain(`${first!.header}\nTheme: API server setup`);
  expect(rendered.text.indexOf(first!.header)).toBeLessThan(rendered.text.indexOf(second!.header));
  expect(rendered.text).toContain(`${second!.header}\n${OH_SESSION_NOTES_NONE_V1}`);
  expect(renderOhSessionNotesV1([]).bytes).toBe(0);
});

test("the notes come first and the log keeps the remaining budget", async () => {
  const plans = prepareOhSessionNotesV1(question, context);
  const notes = plans.map(plan => resolveOhSessionNoteV1(plan, `Theme: part ${plan.ordinal}`));
  const rendered = renderOhSessionNotesV1(notes), seen: number[] = [];
  const generate = async (_question: string, options: { budgetBytes?: number }) => { seen.push(options.budgetBytes!); return { rendering: { context: "LOG" } }; };
  const result = await generateOhNotedAuthorLogContextV1(generate, "q", { asOf: null, budgetBytes: 10_000, retrievedBytes: 4_000, logReserveBytes: 1_000 }, notes);
  expect(seen).toEqual([10_000 - rendered.bytes - 2]);
  expect(result.context).toBe(`${rendered.text}\n\nLOG`);
  await expect(generateOhNotedAuthorLogContextV1(generate, "q", { asOf: null, budgetBytes: 4_100, retrievedBytes: 4_000 }, notes)).rejects.toThrow("too little budget");
  expect((await generateOhNotedAuthorLogContextV1(generate, "q", { asOf: null, budgetBytes: 5_000 }, [])).context).toBe("LOG");
});
