import { describe, expect, test } from "bun:test";
import { EVOLUTION_FACT_CARD_OPERATION_POLICY, runEvolutionFactCardOperations } from "../scripts/benchmarks/evolution-fact-card-ops";

const card = (id: string, quote: string) => ({ id, quote });
const operand = (cardId: string, literal: string) => ({ cardId, literal });
const operation = (kind: string, operands: ReturnType<typeof operand>[], unit: string | null = null) => ({ kind, operands, unit });
const run = (quotes: string[], kind: string, literals = quotes, unit: string | null = null) => runEvolutionFactCardOperations(
  quotes.map((quote, index) => card(String(index), quote)),
  [operation(kind, literals.map((literal, index) => operand(String(index), literal)), unit)],
)[0]!;

describe("source quote literal operations", () => {
  test("decimal and converted-unit arithmetic is exact, including nonterminating ratios", () => {
    expect(run(["0.1", "0.2"], "sum").value).toBe("0.3");
    expect(run(["9007199254740993", "2"], "difference").value).toBe("9007199254740991");
    expect(run(["-0.3", "0.1"], "sum").value).toBe("-0.2");
    expect(run(["1.25 kg", "750 g"], "sum", undefined, "kg").value).toBe("2");
    expect(run(["2 cm", "30 mm"], "difference", undefined, "mm").value).toBe("-10");
    expect(run(["1 s"], "sum", undefined, "min").value).toBe("1/60");
    expect(run(["0.125 h", "0.5 min"], "sum", undefined, "s").value).toBe("480");
    expect(run(["0.1", "0.1"], "difference").value).toBe("0");
  });

  test("unsupported or implicit numeric/unit semantics stay unresolved", () => {
    for (const literal of ["-0", "-0.000", "+1", "01", "1e3", "1,000", "1.", ".5", "NaN", "Infinity", "1.0000000000001"]) {
      expect(run([literal], "sum").status).toBe("unresolved");
    }
    expect(run(["1 kg", "2 m"], "sum", undefined, "g").reason).toBe("unit-dimension-mismatch");
    expect(run(["1 kg"], "sum", ["1"], null).reason).toBe("partial-number-or-date-token");
    expect(run(["1 kg"], "sum", undefined, null).reason).toBe("exact-decimal-literal-required");
    expect(run(["1 kg"], "sum", undefined, "USD").reason).toBe("unsupported-unit");
    expect(run(["1kg"], "sum", undefined, "kg").reason).toBe("explicit-supported-unit-required");
    expect(run(["1 kg", "2 kg", "3 kg"], "difference", undefined, "kg").reason).toBe("operand-count");
  });

  test("dates are complete valid calendar literals; interval direction and ties are explicit", () => {
    expect(run(["2024-02-28", "2024-03-01"], "date-interval-days", undefined, "d").value).toBe("2");
    expect(run(["2024-03-01", "2024-02-28"], "date-interval-days", undefined, "d").value).toBe("-2");
    expect(run(["2024-02-28", "2024-03-01"], "date-interval-days").reason).toBe("calendar-unit-mismatch");
    expect(run(["2024-03-01", "2024-02-28", "2024-03-01"], "date-order").value).toBe("[[1],[0,2]]");
    expect(run(["0001-01-01", "0001-01-02"], "date-interval-days", undefined, "d").value).toBe("1");
    for (const bad of ["2023-02-29", "2024-02-30", "0000-01-01", "2024-13-01", "May 2024", "2024-05", "2024-5-01", "last Tuesday", "about 2024-05-01"]) {
      expect(run([bad, "2024-06-01"], "date-interval-days", undefined, "d").reason).toBe("complete-calendar-date-required");
    }
  });

  test("matching rejects absent, repeated, overlapping, partial and duplicated operands", () => {
    expect(run(["5 and 5"], "sum", ["5"]).reason).toBe("literal-absent-or-ambiguous");
    expect(run(["aaa"], "distinct-literals", ["aa"]).reason).toBe("literal-absent-or-ambiguous");
    expect(run(["15"], "sum", ["5"]).reason).toBe("partial-number-or-date-token");
    expect(run(["-5"], "sum", ["5"]).reason).toBe("partial-number-or-date-token");
    expect(run(["3.25"], "sum", ["3"]).reason).toBe("partial-number-or-date-token");
    expect(run(["x5"], "sum", ["5"]).reason).toBe("partial-number-or-date-token");
    expect(run(["5 kg/d"], "sum", ["5 kg"], "kg").reason).toBe("partial-number-or-date-token");
    expect(run(["1/5"], "sum", ["5"]).reason).toBe("partial-number-or-date-token");
    expect(run(["5"], "sum", ["6"]).reason).toBe("literal-absent-or-ambiguous");
    expect(runEvolutionFactCardOperations([card("a", "5")], [operation("sum", [operand("a", "5"), operand("a", "5")])])[0]!.reason).toBe("duplicate-source-operand");
    expect(runEvolutionFactCardOperations([card("a", "5")], [operation("sum", [operand("missing", "5")])])[0]!.reason).toBe("missing-source-card");
  });

  test("distinct strings do not become entity counts, and evidence has exact UTF8 offsets", () => {
    const quotes = ["Résumé: Ada", "ADA", "Ada"];
    const result = run(quotes, "distinct-literals", ["Ada", "ADA", "Ada"]);
    expect(result.value).toBe("2");
    expect(result.evidence[0]).toEqual({ cardId: "0", literal: "Ada", utf8Start: 10, utf8End: 13 });
    expect(EVOLUTION_FACT_CARD_OPERATION_POLICY.distinctMeaning).toBe("distinct-literal-strings-not-entities-or-events");
    expect(run(["Ada"], "distinct-literals", undefined, "people").reason).toBe("distinct-literals-requires-null-unit");
    expect(run(["😀 result: 12."], "sum", ["12"]).evidence[0]!.utf8Start).toBe(13);
    expect(run(["😀 result: 12."], "sum", ["12"]).value).toBe("12");
  });

  test("cards project only id and quote, all returned values are detached and immutable", () => {
    let reads = 0;
    const source = { id: "c", quote: "42", get answer() { reads++; throw Error("gold getter read"); } };
    const result = runEvolutionFactCardOperations([source], [operation("sum", [operand("c", "42")])]);
    source.quote = "43";
    expect(reads).toBe(0);
    expect(result[0]!.value).toBe("42");
    expect(result[0]!.evidence[0]!.literal).toBe("42");
    for (const value of [result, result[0], result[0]!.evidence, result[0]!.evidence[0], EVOLUTION_FACT_CARD_OPERATION_POLICY, EVOLUTION_FACT_CARD_OPERATION_POLICY.units]) expect(Object.isFrozen(value)).toBe(true);
    expect(() => runEvolutionFactCardOperations([{ id: "a", get quote() { reads++; return "4"; } }], [])).toThrow("data fields");
    expect(reads).toBe(0);
  });

  test("outer/card bounds reject, malformed operations remain indexed unresolved rows without getter reads", () => {
    expect(() => runEvolutionFactCardOperations([], Array(17).fill({}))).toThrow("bounded dense array");
    expect(() => runEvolutionFactCardOperations(Array(33).fill(card("a", "x")), [])).toThrow("bounded dense array");
    expect(() => runEvolutionFactCardOperations([card("a", "x".repeat(2049))], [])).toThrow("invalid or duplicate card");
    expect(() => runEvolutionFactCardOperations([card("a", "x"), card("a", "y")], [])).toThrow("invalid or duplicate card");
    expect(() => runEvolutionFactCardOperations([card("a", "\ud800")], [])).toThrow("invalid or duplicate card");
    expect(() => runEvolutionFactCardOperations([], new Array(1))).toThrow("bounded dense array");
    let reads = 0;
    const inputs = [null, { kind: "eval", operands: [], unit: null }, { get kind() { reads++; return "sum"; }, operands: [], unit: null }, operation("sum", []), { ...operation("sum", []), code: "bad" }];
    const results = runEvolutionFactCardOperations([], inputs);
    expect(results.map(result => result.index)).toEqual([0, 1, 2, 3, 4]);
    expect(results.every(result => result.status === "unresolved" && result.value === null)).toBe(true);
    expect(results[1]!.reason).toBe("unsupported-kind");
    expect(reads).toBe(0);
    expect(runEvolutionFactCardOperations([card("a", "1")], [operation("sum", Array(33).fill(operand("a", "1")))])[0]!.reason).toBe("invalid-operation-shape");
  });
});
