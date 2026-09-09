import { qualifyGatewayOIDC, type GatewayStudyAuth } from "./gateway-study-v3";
import { validateEvolutionRequest, type EvolutionRequest } from "./evolution-model";
import type { EvolutionRaw, EvolutionStore } from "./evolution-store";

export type EvolutionCredential = Readonly<{ kind: "gateway-oidc"; token: string; auth: GatewayStudyAuth }>
  | Readonly<{ kind: "benchmark-openai-key"; token: string }>;
const MAX_RAW = 2 * 1024 * 1024;
type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

/** A captured first response can be finalized after interruption; an ambiguous dispatch
 * retains its full reservation. No retries, provider fallback or answer selection occur. */
export async function invokeEvolutionRequest(input: Readonly<{ request: EvolutionRequest; store: EvolutionStore;
  credential: EvolutionCredential; repeat?: number; stopped?: () => boolean; fetcher?: Fetcher }>) {
  const request = validateEvolutionRequest(input.request), repeat = input.repeat ?? 0, store = input.store;
  const cached = store.lookup(request, repeat);
  if (cached.kind === "hit") return { cached: true, recovered: false, result: cached.result };
  if (cached.kind === "occupied") {
    if (cached.status === "captured") return { cached: true, recovered: true, result: store.finalize(request, repeat) };
    throw new Error("Evolution request has an unresolved reservation; no repeat dispatch.");
  }
  const credential = input.credential;
  const qualify = () => {
    if (input.stopped?.()) throw new Error("Evolution request admission stopped.");
    if (typeof credential.token !== "string" || credential.token.length < 1 || credential.token.length > 32768) throw new Error("Missing bounded benchmark credential.");
    if (request.endpoint === "https://ai-gateway.vercel.sh/v1/chat/completions") {
      if (credential.kind !== "gateway-oidc") throw new Error("Gateway requests require the selected project OIDC identity.");
      qualifyGatewayOIDC(credential.token, credential.auth);
    } else if (request.endpoint !== "https://api.openai.com/v1/chat/completions" || credential.kind !== "benchmark-openai-key") {
      throw new Error("Reader endpoint and credential role do not match.");
    }
  };
  qualify(); store.admit(request, repeat); qualify();
  const started = performance.now();
  let response: Response | null = null, error: EvolutionRaw["error"] = null, complete = false, receivedBytes = 0;
  const chunks: Uint8Array[] = []; let retained = 0;
  try {
    response = await (input.fetcher ?? fetch)(request.endpoint, { method: "POST", redirect: "error",
      signal: AbortSignal.timeout(request.timeoutMs), headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential.token}` },
      body: JSON.stringify(request.body) });
  } catch { error = "network"; }
  if (response !== null) {
    const reader = response.body?.getReader();
    if (reader === undefined) error = "body-read";
    else {
      try {
        while (true) {
          const next = await reader.read(); if (next.done) { complete = true; break; }
          receivedBytes += next.value.length;
          const piece = next.value.slice(0, MAX_RAW - retained); chunks.push(piece); retained += piece.length;
          if (receivedBytes > MAX_RAW) { error = "response-bound"; break; }
        }
      } catch { error = "body-read"; }
      finally { try { await reader.cancel(); } catch { /* First-response failure remains captured. */ } }
    }
  }
  const body = new Uint8Array(retained); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  const serviceMs = performance.now() - started;
  store.capture(request, { httpStatus: response?.status ?? null, body, complete, receivedBytes, error, serviceMs }, repeat);
  const result = store.finalize(request, repeat);
  return { cached: false, recovered: false, result, serviceMs };
}
