import { canonicalSha256 } from "../../src/canonical";

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const item of Object.values(value)) freeze(item); Object.freeze(value); }
  return value;
}
const string = { type: "string" } as const;
const object = <T extends Record<string, unknown>>(properties: T) => ({ type: "object" as const,
  additionalProperties: false as const, properties, required: Object.keys(properties) });
const array = <T>(items: T) => ({ type: "array" as const, items });
const format = <T>(name: string, schema: T) => freeze({ type: "json_schema" as const,
  json_schema: { name, strict: true as const, schema } });

/** Schemas constrain shape; runtime checks also enforce identities, limits and source membership. */
export const OH_TURN_COVERAGE_RESPONSE_FORMAT_V1 = format("oh_turn_coverage_v1", object({
  requestSha256: string,
  users: array(object({ handle: string, status: { type: "string", enum: ["candidate", "irrelevant", "unresolved"] },
    reason: string, mentions: array(object({ facet: string, quote: string,
      stance: { type: "string", enum: ["raised", "tentative", "declined", "unclear"] },
      context: array(object({ handle: string, quote: string })) })) })),
}));
export const OH_TURN_GROUPING_RESPONSE_FORMAT_V1 = format("oh_turn_grouping_v1", object({
  requestSha256: string,
  groups: array(object({ label: string, memberIds: array(string), reason: string })),
  excluded: array(object({ mentionId: string, reason: string })),
  unresolved: array(object({ mentionId: string, reason: string })),
  ambiguities: array(string),
}));
export const OH_TURN_COVERAGE_SCHEMA_SHA256_V1 = canonicalSha256(OH_TURN_COVERAGE_RESPONSE_FORMAT_V1);
export const OH_TURN_GROUPING_SCHEMA_SHA256_V1 = canonicalSha256(OH_TURN_GROUPING_RESPONSE_FORMAT_V1);
