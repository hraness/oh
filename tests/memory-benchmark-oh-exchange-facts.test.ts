import { describe, expect, test } from "bun:test";
import { OH_EXCHANGE_FACTS_LIMITS_V1, generateOhFactAuthorLogContextV1, prepareOhExchangeFactsV1, renderOhExchangeFactsV1,
  resolveOhExchangeFactsV1, windowOhExchangeTurnsV1 } from "../scripts/benchmarks/oh-exchange-facts";

const turn = (sessionId: string, speaker: string, text: string, date = "2024-01-05T00:00:00.000Z") => ({ sessionId, date, speaker, text });

describe("oh exchange facts", () => {
  test("windows hold whole turns within a session and never cross sessions", () => {
    const turns = [turn("s0", "user", "a".repeat(300)), turn("s0", "assistant", "b".repeat(300)), turn("s0", "user", "c".repeat(300)),
      turn("s0", "assistant", "d".repeat(300)), turn("s1", "user", "e", "2024-02-01T00:00:00.000Z")];
    const windows = windowOhExchangeTurnsV1(turns, 700);
    expect(windows.map(window => window.sessionId)).toEqual(["s0", "s0", "s1"]);
    expect(windows[0]!.text.startsWith("[user] ")).toBe(true);
    expect(windows[1]!.text.startsWith("[user] c")).toBe(true);
  });
  test("plans carry no question and are deterministic", () => {
    const turns = [turn("s0", "user", "I set up Socket.io"), turn("s0", "assistant", "Use rooms and clean up listeners")];
    const [plan] = prepareOhExchangeFactsV1(turns);
    expect(plan!.messages[1]!.content).toBe("Session date: 2024-01-05\n\n[user] I set up Socket.io\n[assistant] Use rooms and clean up listeners");
    expect(prepareOhExchangeFactsV1(turns)[0]!.inputSha256).toBe(plan!.inputSha256);
  });
  test("answers parse into bounded fact lines", () => {
    const [plan] = prepareOhExchangeFactsV1([turn("s0", "user", "hi")]);
    const many = Array.from({ length: 30 }, (_, i) => `- User fact ${i} ${"x".repeat(i === 0 ? 900 : 1)}`).join("\n");
    const resolved = resolveOhExchangeFactsV1(plan!, `Preamble\n${many}`);
    expect(resolved.facts.length).toBe(OH_EXCHANGE_FACTS_LIMITS_V1.facts);
    expect(Buffer.byteLength(resolved.facts[0]!)).toBeLessThanOrEqual(OH_EXCHANGE_FACTS_LIMITS_V1.factBytes + 3);
    expect(resolveOhExchangeFactsV1(plan!, "None.").facts).toEqual([]);
    expect(() => resolveOhExchangeFactsV1(plan!, "no bullet lines here")).toThrow();
  });
  test("rendering keeps time order and selects by question words over the bound", () => {
    const windows = [
      { protocol: "oh.exchange-facts.v1" as const, ordinal: 1, sessionId: "s1", date: "2024-02-01T00:00:00.000Z", facts: ["Assistant recommended Redis caching for sessions"], inputSha256: "b" },
      { protocol: "oh.exchange-facts.v1" as const, ordinal: 0, sessionId: "s0", date: "2024-01-05T00:00:00.000Z", facts: ["User adopted Socket.io rooms", "User likes tea"], inputSha256: "a" },
    ];
    const all = renderOhExchangeFactsV1("anything", windows, 10_000);
    expect(all.text.indexOf("[2024-01-05] User adopted")).toBeLessThan(all.text.indexOf("[2024-02-01] Assistant"));
    const headerBytes = Buffer.byteLength(renderOhExchangeFactsV1("x", [], 10).text);
    expect(headerBytes).toBe(0);
    const tight = renderOhExchangeFactsV1("How did caching with Redis go?", windows, all.bytes - 30);
    expect(tight.text).toContain("Redis");
    expect(tight.facts).toBeLessThan(3);
  });
  test("facts precede the log and shrink its budget", async () => {
    const windows = [{ protocol: "oh.exchange-facts.v1" as const, ordinal: 0, sessionId: "s0", date: "2024-01-05T00:00:00.000Z", facts: ["User adopted rooms"], inputSha256: "a" }];
    let seen = 0;
    const result = await generateOhFactAuthorLogContextV1(async (_question, options) => { seen = options.budgetBytes!; return { rendering: { context: "LOG" } }; },
      "q", { budgetBytes: 10_000 }, windows, 5_000);
    expect(result.context.endsWith("\n\nLOG")).toBe(true);
    expect(seen).toBe(10_000 - result.facts.bytes - 2);
  });
});
