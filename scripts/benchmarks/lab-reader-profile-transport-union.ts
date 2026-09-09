import { LAB_GPT5_MINI_RESPONSE_BYTES } from "./lab-reader-profile";
import { GATEWAY_STUDY_RESPONSE_BYTES } from "./gateway-study-transport-v3";
import { canonicalReaderJudgeRequest, type LabReaderJudgeRequest as LabReaderRequest,
  type LabReaderJudgeReservation as LabReaderReservation, type LabReaderJudgeRaw as LabReaderRaw,
  type LabReaderJudgeResult as LabReaderResult } from "./lab-reader-profile-judge";

type Cache = Readonly<{
  lookup(request: LabReaderRequest): Promise<Readonly<{ kind: "miss" }> | Readonly<{ kind: "occupied" }> | Readonly<{ kind: "hit"; result: LabReaderResult }>>;
  admit(request: LabReaderRequest): Promise<LabReaderReservation>;
  capture(request: LabReaderRequest, raw: LabReaderRaw): Promise<void>;
  finalize(request: LabReaderRequest): Promise<LabReaderResult>;
}>;
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** One physical first response. Admission is atomic and durable; no retry or fallback exists. */
export async function invokeLabReaderJudge(options: Readonly<{
  request: LabReaderRequest; cache: Cache; oidcToken: string; qualify(): Promise<void>; fetcher?: Fetcher;
}>): Promise<Readonly<{ cached: boolean; result: LabReaderResult }>> {
  const { cache, oidcToken, qualify } = options, fetcher = options.fetcher ?? fetch;
  const request = canonicalReaderJudgeRequest(options.request);
  const responseBytes = "phase" in request ? GATEWAY_STUDY_RESPONSE_BYTES : LAB_GPT5_MINI_RESPONSE_BYTES;
  if (typeof oidcToken !== "string" || oidcToken.trim() === "") throw new TypeError("Qualified project OIDC is required.");
  await qualify();
  const cached = await cache.lookup(request);
  if (cached.kind === "hit") return { cached: true, result: cached.result };
  if (cached.kind === "occupied") throw new Error("An occupied profile first response cannot be retried.");
  await cache.admit(request);
  await qualify(); // A stopped or expired owner retains its reservation without dispatching.
  let response: Response | null = null, body = new Uint8Array(0), receivedBytes = 0;
  let bodyComplete = false, transportError: LabReaderRaw["transportError"] = null;
  try {
    response = await fetcher(request.endpoint, { method: "POST", redirect: "error",
      signal: AbortSignal.timeout(request.timeoutMs), headers: { "Content-Type": "application/json", Authorization: `Bearer ${oidcToken}` },
      body: JSON.stringify(request.body) });
  } catch { transportError = "network"; }
  if (response !== null) {
    const reader = response.body?.getReader();
    if (reader === undefined) transportError = "body-read";
    else {
      const chunks: Uint8Array[] = []; let retained = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) { bodyComplete = true; break; }
          receivedBytes += next.value.byteLength;
          const piece = next.value.slice(0, responseBytes - retained);
          chunks.push(piece); retained += piece.byteLength;
          if (receivedBytes > responseBytes) { transportError = "response-bound"; break; }
        }
      } catch { transportError = "body-read"; }
      finally { try { await reader.cancel(); } catch { /* Retain the captured failure state. */ } }
      body = new Uint8Array(retained); let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    }
  }
  await cache.capture(request, { requestSha256: request.requestSha256, httpStatus: response?.status ?? null,
    body, bodyComplete, receivedBytes, transportError });
  return { cached: false, result: await cache.finalize(request) };
}
