/** V5 storage fixes the truncation-aware parser while reusing unchanged custody and ledger operations. */
import { gatewayStudyStoreInternals } from "./gateway-study-store-v3";
import { parseGatewayStudyV5, type GatewayStudyV5Result } from "./gateway-study-transport-v5";
import type { GatewayStudyLedgerEvent } from "./gateway-study-transport-v3";
import type { GatewayJob } from "./gateway-study-plan-v3";
const PROFILE = "oh.memory-gateway-store.v5" as const;
export function gatewayV5JobPending(job: GatewayJob, freezeSha256: string) {
  return gatewayStudyStoreInternals.jobPending(job, freezeSha256, PROFILE);
}
export function readGatewayV5SavedJob(directory: string, freezeSha256: string, job: GatewayJob, events: readonly GatewayStudyLedgerEvent[]): Promise<GatewayStudyV5Result> {
  return gatewayStudyStoreInternals.readWithParser(directory, freezeSha256, job, events, PROFILE, parseGatewayStudyV5);
}
export function openGatewayStudyV5Store(directory: string, freezeSha256: string) {
  return gatewayStudyStoreInternals.openWithParser(directory, freezeSha256, PROFILE, parseGatewayStudyV5);
}
