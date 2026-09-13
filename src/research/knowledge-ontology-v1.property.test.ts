import { expect, test } from "bun:test";
import fc from "fast-check";

import { parseSha256Hex, type Sha256Hex } from "./integrity-domain";
import {
  createKnowledgeContextV1,
  createKnowledgeStatementV1,
  parseKnowledgeEntityId,
  parseKnowledgeStatementV1,
  type KnowledgeDimensionV1,
  type KnowledgeEntityId,
  type KnowledgeSchemaRefV1,
} from "./knowledge-ontology-v1";

function required<T>(value: T | null): T {
  if (value === null) throw new Error("Expected a valid fixture value.");
  return value;
}

const digest = required(parseSha256Hex("a".repeat(64))) as Sha256Hex;
const subject = required(
  parseKnowledgeEntityId(`kent_${"s".repeat(24)}`),
) as KnowledgeEntityId;

function schema(code: string): KnowledgeSchemaRefV1 {
  return {
    code,
    namespace: "sponge.property-test",
    revision: 1,
    schemaSha256: digest,
    v: 1,
  };
}

const codes = fc.uniqueArray(
  fc.stringMatching(/^[a-z][a-z0-9]{0,12}$/u),
  { maxLength: 12, minLength: 1 },
);

test("qualifier and context hashes are independent of insertion order", async () => {
  await fc.assert(fc.asyncProperty(codes, async (items) => {
    const dimensions: KnowledgeDimensionV1[] = items.map((code) => ({
      predicate: schema(code),
      v: 1,
      value: { kind: "text", language: "en", text: `value-${code}`, v: 1 },
    }));
    const statementA = await createKnowledgeStatementV1({
      object: { kind: "boolean", v: 1, value: true },
      predicate: schema("has-property"),
      qualifiers: dimensions,
      subject,
      v: 1,
    });
    const statementB = await createKnowledgeStatementV1({
      object: { kind: "boolean", v: 1, value: true },
      predicate: schema("has-property"),
      qualifiers: [...dimensions].reverse(),
      subject,
      v: 1,
    });
    const contextA = await createKnowledgeContextV1({
      dimensions, scenario: "actual", v: 1,
    });
    const contextB = await createKnowledgeContextV1({
      dimensions: [...dimensions].reverse(), scenario: "actual", v: 1,
    });
    expect(statementA.ok && statementB.ok).toBe(true);
    expect(contextA.ok && contextB.ok).toBe(true);
    if (!statementA.ok || !statementB.ok || !contextA.ok || !contextB.ok) return;
    expect(statementA.value.statementSha256).toBe(statementB.value.statementSha256);
    expect(contextA.value.contextSha256).toBe(contextB.value.contextSha256);
  }), { numRuns: 75 });
});

test("changing a statement while retaining its digest always fails closed", async () => {
  await fc.assert(fc.asyncProperty(
    fc.stringMatching(/^[a-z][a-z0-9]{0,12}$/u),
    fc.string({ maxLength: 80, minLength: 1 }).filter((value) =>
      value.normalize("NFC") === value && !/[\u0000-\u001f\u007f-\u009f]/u.test(value)),
    async (predicate, text) => {
      const statement = await createKnowledgeStatementV1({
        object: { kind: "text", language: "en", text, v: 1 },
        predicate: schema(predicate),
        qualifiers: [],
        subject,
        v: 1,
      });
      expect(statement.ok).toBe(true);
      if (!statement.ok) return;
      const parsed = await parseKnowledgeStatementV1({
        ...statement.value,
        object: { ...statement.value.object, text: `${text}x` },
      });
      expect(parsed).toMatchObject({
        error: { code: "digest-mismatch", field: "statementSha256" },
        ok: false,
      });
    },
  ), { numRuns: 75 });
});
