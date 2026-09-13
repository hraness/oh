import type { KnowledgeGraphRecordKindV1 } from "./knowledge-ontology-contract-v1";

/** Authority-free semantic input shared by compilers and storage adapters. */
export type SpongeKnowledgeSemanticRecordInputV2 = Readonly<{
  callerRecordKey?: string;
  kind: KnowledgeGraphRecordKindV1;
  value: unknown;
}>;
