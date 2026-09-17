import { evaluateOhProjectionWithMaterializerV1, type OhProjectionAtomV1, type OhProjectionDatasetV1, type OhProjectionEvaluationOptionsV1, type OhProjectionQueryV1, type OhProjectionResultV1, type OhProjectionRulePackV1, type OhProjectionSnapshotV1 } from "./projection";

type WasmModule = {
  evaluate_projection_js(
    dataset: unknown,
    rulePack: unknown,
    query: unknown,
    options: unknown,
  ): unknown;
  materialize_js(
    dataset: unknown,
    rulePack: unknown,
    options: unknown,
  ): { relations: Record<string, readonly unknown[][]>; baseFacts: number; derivedFacts: number; rounds: number };
  initSync(input: { module: ArrayBufferView | ArrayBuffer }): void;
  default(input?: URL | ArrayBuffer | ArrayBufferView): Promise<unknown>;
};

async function tryLoadWasm(moduleUrl: URL, wasmUrl: URL): Promise<WasmModule | null> {
  try {
    const wasm = (await import(moduleUrl.href)) as WasmModule;
    const buffer = await Bun.file(wasmUrl).arrayBuffer();
    wasm.initSync({ module: buffer });
    return wasm;
  } catch {
    return null;
  }
}

async function loadWasmModule(): Promise<WasmModule | null> {
  return (
    (await tryLoadWasm(
      new URL("../rust-artifacts/oh-datalog-wasm/oh_datalog_wasm.js", import.meta.url),
      new URL("../rust-artifacts/oh-datalog-wasm/oh_datalog_wasm_bg.wasm", import.meta.url),
    )) ??
    (await tryLoadWasm(
      new URL("../rust/oh-datalog-wasm/pkg/oh_datalog_wasm.js", import.meta.url),
      new URL("../rust/oh-datalog-wasm/pkg/oh_datalog_wasm_bg.wasm", import.meta.url),
    ))
  );
}

export const OH_PROJECTION_RUST_ENGINE_V1 = "oh.projection.rust.v1" as const;

export interface ProjectionRustEngineV1 {
  readonly engine: typeof OH_PROJECTION_RUST_ENGINE_V1;
  evaluate(input: Readonly<{
    dataset: OhProjectionDatasetV1;
    options?: OhProjectionEvaluationOptionsV1;
    query: OhProjectionQueryV1;
    rulePack: OhProjectionRulePackV1;
    snapshot: OhProjectionSnapshotV1;
  }>): OhProjectionResultV1;
}

/** Load the Rust WASM positive-Datalog engine behind Oh's result envelope. */
export async function loadProjectionRustEngineV1(): Promise<ProjectionRustEngineV1 | null> {
  const wasm = await loadWasmModule();
  if (wasm === null) return null;

  return {
    engine: OH_PROJECTION_RUST_ENGINE_V1,
    evaluate: (input) => {
      return evaluateOhProjectionWithMaterializerV1({
        ...input,
        engine: OH_PROJECTION_RUST_ENGINE_V1,
        materialize: (program) => {
          const result = wasm.materialize_js(
            program.dataset,
            program.rulePack,
            {
              maximumDerivedTuples: program.maximumDerivedTuples,
              maximumRounds: program.maximumRounds,
              maximumWorkUnits: 16_777_216,
            },
          );
          const relations = result.relations;
          const relationFacts = new Map<string, readonly OhProjectionAtomV1[][]>();
          if (relations instanceof Map) {
            for (const [relation, tuples] of relations.entries()) {
              relationFacts.set(relation, (tuples as unknown[][]).map((tuple: unknown[]) => tuple.map(atomFromUnknown)));
            }
          } else if (relations !== null && typeof relations === "object" && !Array.isArray(relations)) {
            for (const [relation, tuples] of Object.entries(relations as Record<string, unknown[][]>)) {
              relationFacts.set(relation, tuples.map((tuple: unknown[]) => tuple.map(atomFromUnknown)));
            }
          }
          return { relationFacts };
        },
      });
    },
  };
}

function atomFromUnknown(value: unknown): OhProjectionAtomV1 {
  if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
    return value as OhProjectionAtomV1;
  }
  throw new TypeError("Rust projection returned a non-atom tuple element");
}
