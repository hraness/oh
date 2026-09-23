import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { countFrameworkPilotTokenBatchV1, packFrameworkPilotContextWithTiktokenV1 } from "../framework-pilot-tokenizer-v1";

const args = process.argv.slice(2);
assert.equal(args.length, 6);
assert.deepEqual(args.filter((_, index) => index % 2 === 0), ["--python", "--artifacts", "--output"]);
const python = args[1]!, artifactsDirectory = args[3]!, output = args[5]!;
assert([python, artifactsDirectory, output].every(path => isAbsolute(path) && !/[\u0000-\u001f\u007f]/.test(path)));
const fixturePath = join(import.meta.dir, "../../../tests/fixtures/framework-pilot-tokenizer-v1.json");
const fixtureBytes = readFileSync(fixturePath);
assert.equal(createHash("sha256").update(fixtureBytes).digest("hex"), "4278140dea12fc079ba809c6f241d178b58e2174eac8d13298c9e4b11e19e8e5");
const fixture: { rows: { text: string; tokens: number[] }[] } = JSON.parse(fixtureBytes.toString("utf8"));
const configuration = { python, artifactsDirectory };
const api = (() => {
  const scratch = mkdtempSync(join(tmpdir(), "oh-tokenizer-api-qualification-"));
  try {
    return spawnSync(realpathSync(python), ["-I", "-S", "-B", join(import.meta.dir, "qualify.py"), artifactsDirectory, fixturePath],
      { env: { LC_ALL: "C", TMPDIR: scratch }, timeout: 30_000, maxBuffer: 32_768, killSignal: "SIGKILL" });
  } finally { rmSync(scratch, { recursive: true, force: true }); }
})();
assert.equal(api.error, undefined); assert.equal(api.status, 0); assert.equal(api.signal, null); assert.equal(api.stderr.byteLength, 0);
const officialParity = JSON.parse(api.stdout.toString("utf8"));
assert.equal(officialParity.parity, "pass");
const batch = countFrameworkPilotTokenBatchV1({ protocol: "oh.framework-pilot-token-batch-input.v1", texts: fixture.rows.map(row => row.text) }, configuration);
assert.deepEqual(batch.rows.map(row => row.tokens), fixture.rows.map(row => row.tokens.length));
assert.deepEqual(batch.provenance, officialParity.provenance);
const context = (content: string, limit = 8192) => ({ protocol: "oh.framework-pilot-context-input.v1", maxContextTokens: limit,
  candidates: [{ unitId: "u000001", content }] });
const exact = packFrameworkPilotContextWithTiktokenV1(context("a ".repeat(8181)), configuration);
assert.equal(exact.context.contextTokens, 8192); assert.equal(exact.context.included.length, 1);
const overflow = packFrameworkPilotContextWithTiktokenV1(context("a ".repeat(8182)), configuration);
assert.equal(overflow.context.contextTokens, 0); assert.equal(overflow.context.included.length, 0);
assert.equal(overflow.context.omitted[0]!.attemptedContextTokens, 8193);
const ranked = packFrameworkPilotContextWithTiktokenV1({ protocol: "oh.framework-pilot-context-input.v1", maxContextTokens: 23,
  candidates: [{ unitId: "u000001", content: "a" }, { unitId: "u000001", content: "a" }, { unitId: "u000002", content: "a" },
    { unitId: "u000003", content: "<|endoftext|>" }] }, configuration);
assert.equal(ranked.context.contextTokens, 12);
assert.deepEqual(ranked.context.omitted.map(item => item.reason), ["duplicate", "overflow", "after-overflow"]);
assert.equal(ranked.context.omitted[1]!.attemptedContextTokens, 24);
assert.equal(ranked.tokenization.rows.length, 4); // empty plus all three complete unique prefixes
const receipt = { protocol: "oh.framework-pilot-tokenizer-qualification-receipt.v1", officialParity,
  boundaryPacking: { exactTokens: exact.context.contextTokens, overflowTokens: overflow.context.omitted[0]!.attemptedContextTokens,
    rankedPrefixTokens: ranked.context.contextTokens, completePrefixCount: ranked.tokenization.rows.length },
  limitations: ["context-string-only", "no-model-request", "observed-interpreter-identity-not-toolchain-attestation"] };
writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ parity: "pass", fixtures: fixture.rows.length, exactBoundary: 8192, overflow: 8193 }));
