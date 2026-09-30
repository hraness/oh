/** Offline context replay. Both arms consume the same gold-free source and native ranks. */
import { sha256Hex } from "../../../src/canonical";
import { composeOhAuthorLogContextV1 } from "../oh-author-log-context";
import { projectOhEvidenceTurnsV1, type OhNativeRankListV1 } from "../oh-evidence-context";
import { exact, integer, list, need, text, unique, type CampaignConfig, type TaskInput } from "./campaign-contract-v3";
import { readPinned } from "./campaign-store-v3";

export function verifyContexts(config: CampaignConfig, input: TaskInput): void {
  need(input.contexts.length === config.contextPolicies.length && input.contexts.every(c => config.contextPolicies.some(p => p.id === c.policyId)), "context policy denominator differs");
  for (const c of input.contexts) need(sha256Hex(c.context) === c.sha256, "context digest differs");
  if (input.source === null || input.ranking === null) {
    need(input.controlAnswer !== null && input.contexts.every(c => c.context === input.contexts[0]!.context), "controls must use identical invented contexts");
    return;
  }
  const source = exact(JSON.parse(readPinned(input.source, 32 * 1024 * 1024)), ["protocol", "turns"]);
  need(source.protocol === "oh.memory-lab-source.v1", "gold-free source projection required");
  const turns = list(source.turns, 1, 8192).map(value => {
    const hasIndex = typeof value === "object" && value !== null && Object.hasOwn(value, "sessionIndex");
    const t = exact(value, ["id", "sessionId", "date", "speaker", "text", ...(hasIndex ? ["sessionIndex"] : [])]);
    need(typeof t.text === "string" && Buffer.byteLength(t.text) <= 1024 * 1024 && !/\p{Surrogate}/u.test(t.text), "invalid source text");
    need(typeof t.date === "string" && Buffer.byteLength(t.date) <= 128 && !/\p{Surrogate}/u.test(t.date), "invalid source date");
    return { id: text(t.id, 1024), sessionId: text(t.sessionId, 1024), date: t.date, speaker: text(t.speaker, 128), text: t.text,
      ...(hasIndex ? { sessionIndex: integer(t.sessionIndex, 0, 8191) } : {}) };
  });
  unique(turns.map(t => t.id));
  const ranking = exact(JSON.parse(readPinned(input.ranking, 131072)), ["protocol", "sourceSha256", "querySha256", "profileSha256", "rankings"]);
  need(ranking.protocol === "oh.memory-lab-native-ranks.v1" && ranking.sourceSha256 === input.source.sha256
    && ranking.querySha256 === sha256Hex(input.question) && ranking.profileSha256 === config.rankingProfileSha256, "native rank provenance differs");
  const rankings: OhNativeRankListV1[] = list(ranking.rankings, 2, 2).map(value => {
    const r = exact(value, ["source", "kind", "stage", "hits"]);
    need(r.stage === "native" && (r.source === "bm25-native" && r.kind === "lexical" || r.source === "oh-vector-native" && r.kind === "vector"), "native lexical/vector ranks required");
    const hits = list(r.hits, 0, 100).map(value => { const h = exact(value, ["turnId", "rank"]); return { turnId: text(h.turnId, 1024), rank: integer(h.rank, 1, 100) }; });
    unique(hits.map(h => h.turnId)); unique(hits.map(h => String(h.rank)));
    return { source: String(r.source), kind: r.kind as "lexical" | "vector", stage: "native", hits };
  });
  unique(rankings.map(r => r.source));
  const projection = projectOhEvidenceTurnsV1(turns);
  for (const policy of config.contextPolicies) {
    const rendered = composeOhAuthorLogContextV1({ projection, rankings }, { asOf: input.questionDate, budgetBytes: 180000,
      retrievedBytes: 96000, logReserveBytes: policy.logReserveBytes, topK: 100, previousTurns: 1, nextTurns: 1, rrfK: 60 });
    const retained = input.contexts.find(c => c.policyId === policy.id)!;
    need(rendered.context === retained.context && rendered.contextSha256 === retained.sha256, "frozen context differs from source/rank/policy replay");
  }
}
