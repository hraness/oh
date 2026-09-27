/** Fixed experimental output grammar. Handle ranges are structural bounds, not
 * claims about source membership or the number of relevant events in a request. */
import { canonicalSha256, type JsonValue } from "../../src/canonical";

export const OH_EVENT_INVENTORY_V3_MENTION_KINDS = Object.freeze(["event", "state", "plan", "suggestion", "unclear"] as const);
export const OH_EVENT_INVENTORY_V3_LINK_KINDS = Object.freeze(["before", "same-event", "distinct-event", "supersedes", "cancels", "reactivates"] as const);
export const OH_EVENT_INVENTORY_V3_SOURCE_PATTERN = "^s(?:0|[1-9][0-9]?|1[0-9]{2}|2[0-4][0-9]|25[0-5])$";
export const OH_EVENT_INVENTORY_V3_MENTION_PATTERN = "^m(?:[0-9]|[1-3][0-9]|4[0-7])$";
export const OH_EVENT_INVENTORY_V3_LINK_PATTERN = "^l(?:[0-9]|[1-8][0-9]|9[0-5])$";

const mentionId = { type: "string", pattern: OH_EVENT_INVENTORY_V3_MENTION_PATTERN };
const source = { type: "object", additionalProperties: false, required: ["handle", "quote"], properties: {
  handle: { type: "string", pattern: OH_EVENT_INVENTORY_V3_SOURCE_PATTERN },
  quote: { type: "string", minLength: 1, maxLength: 4096 },
} };
const schema = { type: "object", additionalProperties: false, required: ["requestSha256", "mentions", "links"], properties: {
  requestSha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
  mentions: { type: "array", maxItems: 48, items: {
    type: "object", additionalProperties: false, required: ["id", "kind", "source", "timeExpression", "facet"], properties: {
      id: mentionId, kind: { type: "string", enum: [...OH_EVENT_INVENTORY_V3_MENTION_KINDS] }, source,
      timeExpression: { anyOf: [{ type: "null" }, { type: "string", minLength: 1, maxLength: 256 }] },
      facet: { type: "string", minLength: 1, maxLength: 256 },
    },
  } },
  links: { type: "array", maxItems: 96, items: {
    type: "object", additionalProperties: false, required: ["id", "kind", "from", "to", "source"], properties: {
      id: { type: "string", pattern: OH_EVENT_INVENTORY_V3_LINK_PATTERN },
      kind: { type: "string", enum: [...OH_EVENT_INVENTORY_V3_LINK_KINDS] }, from: mentionId, to: mentionId, source,
    },
  } },
} } satisfies JsonValue;
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
export const OH_EVENT_INVENTORY_V3_RESPONSE_FORMAT = freeze({ type: "json_schema" as const,
  json_schema: { name: "oh_event_inventory_v3" as const, strict: true as const, schema } });
export const OH_EVENT_INVENTORY_V3_SCHEMA_SHA256 = canonicalSha256(OH_EVENT_INVENTORY_V3_RESPONSE_FORMAT);
