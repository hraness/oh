// Page metadata and the generated social images read these strings, so each
// title and description is written once. Image alt text comes from ./social.

export const homeTitle = "Oh: open-source agent memory that shows its work";
export const homeDescription =
  "Oh is open-source memory for agents that stores each fact with its sources and every change in a history you can replay.";
export const specificationTitle = "Oh: Ontology specification v1";
export const specificationDescription =
  "Oh’s v1 specification defines how records are encoded, stored in SQLite, and synced between databases, down to the bytes each SHA-256 digest covers.";
export const benchmarksTitle = "Oh agent memory benchmarks: LongMemEval-S, LoCoMo, CloneMem";
export const benchmarksDescription =
  "Every memory benchmark result Oh has published, with the score, setup, and main limit for each study and a link to its full record.";
export const compareTitle = "Oh vs Mem0, Supermemory, and Zep: agent memory compared";
export const compareDescription =
  "Oh, Mem0, Supermemory, Zep, Letta, and Claude’s memory tool in one table: which to pick for which job, with matched benchmark runs and dated sources.";
export const compareMem0Title = "Oh vs Mem0: local agent memory vs per-user memory";
export const compareMem0Description =
  "Mem0 vs Oh: Mem0 gives products per-end-user memory, hosted or self-hosted; Oh keeps an agent’s working memory in local SQLite, each fact linked to sources.";
export const compareSupermemoryTitle = "Oh vs Supermemory: local vs hosted agent memory";
export const compareSupermemoryDescription =
  "Supermemory vs Oh: a hosted memory API with connectors, or local memory for agent work. Supermemory led a 60-question pilot within the margin of error.";


// Share-card copy. A card has room for about two short lines under its
// headline, so each page gets a shorter line carrying the same facts as its
// meta description instead of a clipped one. tests/social-image.test.ts checks
// that every card shows its copy whole.
export const homeCardDescription = "Open-source memory for agents, with sources and a replayable history.";
export const specificationCardDescription =
  "How Oh encodes records, stores them in SQLite, and syncs them, down to the bytes each digest covers.";
export const benchmarksCardDescription =
  "Every memory benchmark Oh has published, with the score, setup, and main limit of each study.";
export const compareCardDescription =
  "Oh, Mem0, Supermemory, Zep, Letta, and Claude’s memory tool: which to pick for which job.";
export const compareMem0CardDescription =
  "Mem0 keeps memory for each end user of a product. Oh keeps an agent’s working memory in local SQLite.";
export const compareSupermemoryCardDescription =
  "Supermemory is a hosted memory API with connectors. Oh keeps memory for agent work in local SQLite.";
