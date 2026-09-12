/** Static experimental evidence-output schema. This constrains wire shape only;
 * callers still validate source identity, exact quotes, UTF-8 limits and semantics. */
import { canonicalSha256 } from "../../src/canonical";
import { OBSERVE_EXTRACTOR_V2_RESPONSE_FORMAT } from "./observe-extractor-v2";

export const OBSERVE_EXTRACTOR_V3_MODES = Object.freeze(["asserted", "planned", "requested", "recommended", "conditional", "hypothetical", "uncertain"] as const);
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
const base = OBSERVE_EXTRACTOR_V2_RESPONSE_FORMAT.json_schema.schema, observations = base.properties.observations, item = observations.items;
export const OBSERVE_EXTRACTOR_V3_RESPONSE_FORMAT = freeze({ type: "json_schema" as const, json_schema: {
  name: "oh_observation_extraction_v3", strict: true, schema: { ...base, properties: { observations: { ...observations, items: {
    ...item, required: [...item.required, "modes", "evidence"], properties: { ...item.properties,
      modes: { type: "array", minItems: 1, maxItems: OBSERVE_EXTRACTOR_V3_MODES.length, items: { type: "string", enum: [...OBSERVE_EXTRACTOR_V3_MODES] } },
      evidence: { type: "array", minItems: 1, maxItems: 16, items: {
        type: "object", additionalProperties: false, required: ["turn", "quote"], properties: {
          turn: item.properties.attributionTurn, quote: { type: "string", minLength: 1, maxLength: 2048 },
        } } },
    } } } } } } });
export const OBSERVE_EXTRACTOR_V3_SCHEMA_SHA256 = canonicalSha256(OBSERVE_EXTRACTOR_V3_RESPONSE_FORMAT);
