import { canonicalSha256, parseSha256Hex } from "../../src/canonical";
import { gatewayStudyStoreInternals, type GatewayStoreJob } from "./gateway-study-store-v3";
import { makeGatewayStudyRequest, type GatewayStudyRequest, type GatewayStudyLedgerEvent,
  type GatewayStudyRaw } from "./gateway-study-transport-v3";
import { parseGatewayStudyV6, type GatewayStudyV6Result } from "./gateway-study-transport-v6";

const PROFILE = "oh.memory-gateway-lab-cache.v1" as const;
export type LabPaidCacheJob = Extract<GatewayStoreJob, Readonly<{ phase: "reader" | "judge" }>>;

/** The caller authenticates the namespace configuration; this helper binds its digest to an
 * exact canonical reader/judge request. Physical cache identity never depends on a case ordinal. */
export function labPaidCacheJob(namespaceSha256: string, request: GatewayStudyRequest): LabPaidCacheJob {
  if (parseSha256Hex(namespaceSha256) === null) throw new TypeError("Invalid paid cache namespace digest.");
  if (request.phase !== "reader" && request.phase !== "judge") throw new TypeError("Paid lab cache accepts reader and judge requests only.");
  const checked = makeGatewayStudyRequest({ phase: request.phase, messages: request.body.messages });
  if (canonicalSha256(checked) !== canonicalSha256(request)) throw new TypeError("Paid cache request differs from its canonical profile.");
  return Object.freeze({ key: canonicalSha256({ namespaceSha256, requestSha256: checked.requestSha256 }),
    ordinal: 0, phase: request.phase, request: checked });
}

/** Reuses the durable first-response store with a separate lab cache profile. Its inherited
 * freezeSha256 field binds the caller-pinned cache namespace, not a frozen study. The coordinator
 * owns experiment aliases, ancestry accounting, global paid ownership and the shared budget. */
export async function openLabPaidCache(input: Readonly<{ directory: string; namespaceSha256: string }>) {
  const { namespaceSha256 } = input;
  if (parseSha256Hex(namespaceSha256) === null) throw new TypeError("Invalid paid cache namespace digest.");
  const store = await gatewayStudyStoreInternals.openWithParser(input.directory, namespaceSha256, PROFILE, parseGatewayStudyV6);
  const job = (request: GatewayStudyRequest) => labPaidCacheJob(namespaceSha256, request);
  return {
    namespaceSha256, exposure: store.exposure,
    get events(): readonly GatewayStudyLedgerEvent[] { return store.events; },
    keys: () => store.keys(), job,
    lookup: (request: GatewayStudyRequest) => store.lookup(job(request)),
    begin: (request: GatewayStudyRequest) => store.begin(job(request)),
    record: (request: GatewayStudyRequest, event: GatewayStudyLedgerEvent) => store.record(job(request), event),
    capture: (request: GatewayStudyRequest, raw: GatewayStudyRaw) => store.capture(job(request), raw),
    complete: (request: GatewayStudyRequest, result: GatewayStudyV6Result) => store.complete(job(request), result),
    close: () => store.close(),
  };
}
