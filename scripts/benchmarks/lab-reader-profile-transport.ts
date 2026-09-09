import { canonicalSha256 } from "../../src/canonical";
import { LAB_GPT5_MINI_MEDIUM_READER_PROFILE, LAB_GPT5_MINI_RESPONSE_BYTES, makeLabGpt5MiniReaderRequest,
  type LabReaderRaw, type LabReaderRequest, type LabReaderReservation, type LabReaderResult } from "./lab-reader-profile";

type Cache = Readonly<{
  lookup(request: LabReaderRequest): Promise<Readonly<{ kind: "miss" }> | Readonly<{ kind: "occupied" }> | Readonly<{ kind: "hit"; result: LabReaderResult }>>;
  admit(request: LabReaderRequest): Promise<LabReaderReservation>;
  capture(request: LabReaderRequest, raw: LabReaderRaw): Promise<void>;
  finalize(request: LabReaderRequest): Promise<LabReaderResult>;
}>;
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** One physical first response. Admission is atomic and durable; no retry or fallback exists. */
export async function invokeLabGpt5MiniReader(options: Readonly<{
  request: LabReaderRequest; cache: Cache; oidcToken: string; qualify(): Promise<void>; fetcher?: Fetcher;
}>): Promise<Readonly<{ cached: boolean; result: LabReaderResult }>> {
  const { cache, oidcToken, qualify } = options, fetcher = options.fetcher ?? fetch;
  const request = makeLabGpt5MiniReaderRequest(options.request.body.messages, { profile: options.request.protocol === LAB_GPT5_MINI_MEDIUM_READER_PROFILE ? "medium" : "minimal" });
  if (canonicalSha256(request) !== canonicalSha256(options.request)) throw new TypeError("Reader request differs from the canonical profile.");
  if (typeof oidcToken !== "string" || oidcToken.trim() === "") throw new TypeError("Qualified project OIDC is required.");
  await qualify();
  const cached = await cache.lookup(request);
  if (cached.kind === "hit") return { cached: true, result: cached.result };
  if (cached.kind === "occupied") throw new Error("An occupied reader first response cannot be retried.");
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
          const piece = next.value.slice(0, LAB_GPT5_MINI_RESPONSE_BYTES - retained);
          chunks.push(piece); retained += piece.byteLength;
          if (receivedBytes > LAB_GPT5_MINI_RESPONSE_BYTES) { transportError = "response-bound"; break; }
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
