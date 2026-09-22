import { expect, test } from "bun:test";
import { sha256Hex } from "../src/canonical";
import { compositionContexts } from "../scripts/benchmarks/locomo-composition-dev-source";
import { renderTurn } from "../scripts/benchmarks/retrieval";

const turns = [1, 2, 3, 4].map(i => ({ id: `D1:${i}`, sessionId: "session-1", sessionIndex: 0,
  date: `2023-05-0${i}`, speaker: i % 2 ? "Person A" : "Person B", text: `évidence ${i} 🧠` }));
const selected = { turnIds: ["D1:4", "D1:1", "D1:3"],
  context: [turns[3]!, turns[0]!, turns[2]!].map(renderTurn).join("\n\n") };

test("composition arms preserve exact Unicode context, sparse selection and retrieval order", () => {
  const contexts = compositionContexts({ turns }, selected);
  expect(contexts.map(row => row.armId)).toEqual(["vector-window", "vector-window-composition"]);
  for (const context of contexts) {
    expect(context.text).toBe(selected.context);
    expect(context.contextSha256).toBe(sha256Hex(selected.context));
    expect(context.turnIds).toEqual(["D1:4", "D1:1", "D1:3"]);
    expect(Object.isFrozen(context)).toBeTrue();
    expect(Object.isFrozen(context.turnIds)).toBeTrue();
  }
  expect(contexts[0]!.turnIds).not.toBe(contexts[1]!.turnIds);
  expect(selected.turnIds).toEqual(["D1:4", "D1:1", "D1:3"]);
  expect(compositionContexts({ turns }, { context: "", turnIds: [] }).map(row => row.text)).toEqual(["", ""]);
});

test("source admission rejects rewritten, reordered, duplicated, unknown or oversized selected data", () => {
  expect(() => compositionContexts({ turns }, { ...selected, context: selected.context.replace("évidence", "rewritten") })).toThrow("text");
  expect(() => compositionContexts({ turns }, { ...selected, turnIds: [...selected.turnIds].reverse() })).toThrow("order");
  expect(() => compositionContexts({ turns }, { ...selected, context: selected.context.replaceAll("\n\n", "\n") })).toThrow("separator");
  expect(() => compositionContexts({ turns }, { ...selected, turnIds: ["D1:4", "D1:4"] })).toThrow("bound");
  expect(() => compositionContexts({ turns }, { context: "", turnIds: ["missing"] })).toThrow("unknown");
  expect(() => compositionContexts({ turns: [...turns, turns[0]!] }, selected)).toThrow("ambiguous");
  expect(() => compositionContexts({ turns }, { context: "é".repeat(6001), turnIds: [] })).toThrow("bound");
});
