import { marketing } from "../portfolio-copy";
// Page metadata and the generated social images read these strings, so each
// title and description is written once. Image alt text comes from ./social.

export const homeTitle = `${marketing.names.name}: ${marketing.hero.heading}`;
export const homeDescription =
  marketing.meta;
export const specificationTitle = `${marketing.names.name} ontology v1: records, storage, and sync specification`;
export const specificationDescription =
  "Oh’s v1 specification defines how records are encoded, stored in SQLite, and synced between databases, down to the bytes each SHA-256 digest covers.";
export const benchmarksTitle = `${marketing.names.name} agent memory benchmarks: LongMemEval-S, LoCoMo, CloneMem`;
export const benchmarksDescription =
  "Every memory benchmark result Oh has published, with the score, setup, and main limit for each study and a link to its full record.";
export const compareTitle = `${marketing.names.name} vs Mem0, Supermemory, and Zep: agent memory compared`;
export const compareDescription =
  "Oh, Mem0, Supermemory, Zep, Letta, and Claude’s memory tool in one table: which to pick for which job, with matched benchmark runs and dated sources.";
export const compareMem0Title = `${marketing.names.name} vs Mem0: local agent memory vs per-user memory`;
export const compareMem0Description =
  "Mem0 vs Oh: Mem0 gives products per-end-user memory, hosted or self-hosted; Oh keeps an agent’s working memory in local SQLite, each fact linked to sources.";
export const compareSupermemoryTitle = `${marketing.names.name} vs Supermemory: local vs hosted agent memory`;
export const compareSupermemoryDescription =
  "Supermemory vs Oh: a hosted memory API with connectors, or local memory for agent work. Supermemory led a 60-question pilot within the margin of error.";


// Share-card copy. A card has room for about two short lines under its
// headline, so each page gets a shorter line carrying the same facts as its
// meta description instead of a clipped one. tests/social-image.test.ts checks
// that every card shows its copy whole.
export const homeCardDescription = marketing.short;
export const specificationCardDescription =
  "How Oh encodes, stores, and syncs records, down to the bytes each digest covers.";
export const benchmarksCardDescription =
  "Every benchmark Oh has published, with each study’s score, setup, and main limit.";
export const compareCardDescription =
  "Oh, Mem0, Supermemory, Zep, Letta, and Claude’s memory tool: which fits which job.";
export const compareMem0CardDescription =
  "Mem0 keeps memory for each end user. Oh keeps an agent’s memory in local SQLite.";
export const compareSupermemoryCardDescription =
  "Supermemory is a hosted API with connectors. Oh keeps agent memory in local SQLite.";
