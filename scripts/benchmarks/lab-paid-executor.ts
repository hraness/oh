import { canonicalSha256 } from "../../src/canonical";
import { gatewayReservation } from "./gateway-study-store-v3";
import { GatewayStudyBudget, makeGatewayStudyRequest, type GatewayStudyRequest } from "./gateway-study-transport-v3";
import { invokeGatewayStudyV6, type GatewayStudyV6Result } from "./gateway-study-transport-v6";
import { type openLabPaidCache } from "./lab-paid-cache";
import { runLabPaidQueue } from "./lab-paid-queue";

type Cache = Awaited<ReturnType<typeof openLabPaidCache>>;
type Options = Readonly<{
  requests: readonly GatewayStudyRequest[]; cache: Cache; budget: GatewayStudyBudget;
  concurrency: number; oidcToken: string; qualify: () => void; stopped: () => boolean;
  invoke?: typeof invokeGatewayStudyV6;
}>;

export class LabPaidAdmissionStopped extends Error {
  constructor(reason: string) { super(reason); this.name = "LabPaidAdmissionStopped"; }
}

/** One phase, one store and shared budget. Only the short begin/start section is serialized;
 * inference runs concurrently and every newly free slot immediately starts another job.
 * Cache replay authenticates original bytes. An occupied incomplete job is never a miss.
 */
export async function executeLabPaidPhase(options: Options) {
  const { cache, budget } = options;
  if (!Number.isSafeInteger(options.concurrency) || options.concurrency < 1 || options.concurrency > 12) {
    throw new RangeError("Paid concurrency must be between 1 and 12.");
  }
  const unique = new Map<string, GatewayStudyRequest>();
  for (const request of options.requests) {
    if (request.phase !== "reader" && request.phase !== "judge"
      || canonicalSha256(request) !== canonicalSha256(makeGatewayStudyRequest({ phase: request.phase, messages: request.body.messages }))) {
      throw new TypeError("Paid phase requires canonical reader or judge requests.");
    }
    const job = cache.job(request);
    if (unique.has(job.key)) throw new TypeError("Paid phase requires distinct physical requests.");
    unique.set(job.key, request);
  }
  if (new Set([...unique.values()].map(request => request.phase)).size > 1) throw new TypeError("Do not mix reader and judge phases.");
  const responses = new Map<string, GatewayStudyV6Result>();
  const cachedKeys: string[] = [];
  for (const [key, request] of unique) {
    const result = await cache.lookup(request);
    if (result !== null) { responses.set(key, result); cachedKeys.push(key); }
  }
  const jobs = [...unique].filter(([key]) => !responses.has(key)).map(([key, request]) => ({ key, request }));
  let admission: Promise<void> = Promise.resolve();
  let failed = false;
  const stopped = () => failed || options.stopped();
  const execution = await runLabPaidQueue(jobs, { concurrency: options.concurrency, stopped,
    execute: async job => {
      const launch = admission.then(async () => {
        if (stopped()) throw new LabPaidAdmissionStopped("Admission stopped before a new request.");
        options.qualify();
        const reservation = gatewayReservation(cache.job(job.request));
        const summary = budget.summary;
        if (summary.reservedCalls >= summary.maxCalls
          || Math.round(summary.accountedUsd * 1_000_000) + reservation.micros > Math.round(summary.capUsd * 1_000_000)) {
          throw new LabPaidAdmissionStopped("Call or spending limit reached before creating a pending job.");
        }
        await cache.begin(job.request);
        // The shared invoker reserves synchronously before its first await. Return the
        // Promise inside an object so this short admission lock never waits for inference.
        const response = (options.invoke ?? invokeGatewayStudyV6)({ request: job.request, oidcToken: options.oidcToken,
          reservationId: job.key, budget, record: event => cache.record(job.request, event),
          capture: raw => cache.capture(job.request, raw) });
        return { response };
      });
      admission = launch.then(() => undefined, () => { failed = true; });
      try {
        const { response } = await launch;
        const result = await response;
        await cache.complete(job.request, result);
        responses.set(job.key, result);
        return result;
      } catch (error) { failed = true; throw error; }
    },
  });
  await admission;
  return { responses, cachedKeys, execution, complete: responses.size === unique.size,
    requestedKeys: [...unique.keys()], budget: budget.summary };
}
