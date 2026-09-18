import { describe, expect, test } from "bun:test";
import {
  findOhRustArtifact,
  loadOhRustArtifactManifest,
  parseOhRustArtifactManifest,
  type OhRustArtifactManifest,
} from "./artifact-manifest";

const VALID_ENTRY = {
  engine: "oh.canonical.rust.v1",
  abi: "oh.canonical-raw-abi.v1",
  crate: "oh-canonical-raw-wasm",
  kind: "cargo-wasm",
  target: "wasm32",
  files: ["oh-canonical-raw-wasm/artifact.js", "oh-canonical-raw-wasm/oh_canonical_raw_wasm.wasm"],
  primary: "oh-canonical-raw-wasm/oh_canonical_raw_wasm.wasm",
  sha256: "0".repeat(64),
  bytes: 12345,
  maxInputBytes: 16 * 1024 * 1024,
} as const;

function validManifest(): OhRustArtifactManifest {
  const parsed = parseOhRustArtifactManifest({ version: 1, artifacts: [VALID_ENTRY] });
  if (parsed === null) throw new Error("fixture manifest must parse");
  return parsed;
}

describe("parseOhRustArtifactManifest", () => {
  test("accepts a well-formed manifest", () => {
    const manifest = validManifest();
    expect(manifest.version).toBe(1);
    expect(manifest.artifacts).toHaveLength(1);
    expect(manifest.artifacts[0]?.engine).toBe("oh.canonical.rust.v1");
  });

  test("rejects malformed envelopes and entries", () => {
    const cases: unknown[] = [
      null,
      {},
      { version: 2, artifacts: [VALID_ENTRY] },
      { version: 1, artifacts: [] },
      { version: 1, artifacts: [{ ...VALID_ENTRY, sha256: "not-a-digest" }] },
      { version: 1, artifacts: [{ ...VALID_ENTRY, kind: "docker" }] },
      { version: 1, artifacts: [{ ...VALID_ENTRY, primary: "../escape.wasm" }] },
      { version: 1, artifacts: [{ ...VALID_ENTRY, primary: "oh-other/x.wasm" }] },
      { version: 1, artifacts: [{ ...VALID_ENTRY, bytes: 0 }] },
      { version: 1, artifacts: [{ ...VALID_ENTRY, maxInputBytes: 0 }] },
      { version: 1, artifacts: [{ ...VALID_ENTRY, files: [] }] },
      { version: 1, artifacts: [VALID_ENTRY, VALID_ENTRY] },
    ];
    for (const value of cases) expect(parseOhRustArtifactManifest(value)).toBeNull();
  });

  test("accepts an unbounded maxInputBytes contract", () => {
    const parsed = parseOhRustArtifactManifest({
      version: 1,
      artifacts: [{ ...VALID_ENTRY, maxInputBytes: null }],
    });
    expect(parsed?.artifacts[0]?.maxInputBytes).toBeNull();
  });
});

describe("findOhRustArtifact", () => {
  test("matches by ABI and optional target", () => {
    const manifest = validManifest();
    expect(findOhRustArtifact(manifest, "oh.canonical-raw-abi.v1")?.crate).toBe("oh-canonical-raw-wasm");
    expect(findOhRustArtifact(manifest, "oh.canonical-raw-abi.v1", "wasm32")?.crate).toBe("oh-canonical-raw-wasm");
    expect(findOhRustArtifact(manifest, "oh.canonical-raw-abi.v1", "linux-x64")).toBeNull();
    expect(findOhRustArtifact(manifest, "oh.missing-abi.v1")).toBeNull();
  });
});

describe("loadOhRustArtifactManifest", () => {
  test("loads the generated manifest shipped with built artifacts", async () => {
    const manifest = await loadOhRustArtifactManifest();
    expect(manifest).not.toBeNull();
    const engines = new Set(manifest?.artifacts.map((entry) => entry.engine));
    for (const engine of [
      "oh.canonical.rust.v1",
      "oh.archive.rust.v1",
      "oh.archive.strict.rust.v1",
      "oh.projection.rust.v1",
    ]) {
      expect(engines.has(engine)).toBe(true);
    }
    const canonicalRaw = findOhRustArtifact(manifest!, "oh.canonical-raw-abi.v1", "wasm32");
    expect(canonicalRaw?.maxInputBytes).toBe(16 * 1024 * 1024);
    expect(canonicalRaw?.sha256).toMatch(/^[0-9a-f]{64}$/u);
  });
});
