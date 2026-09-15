import { builtinModules } from "node:module";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { publicReleaseEnvironment } from "./release-process-environment";
import { runBoundedProcess } from "./run-bounded-process";

const root = new URL("../", import.meta.url).pathname;
const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
  exports: Record<string, { import: string }>;
};
const researchExport = manifest.exports["./research"];
if (researchExport === undefined || !researchExport.import.startsWith("./dist/")) {
  throw new Error("Missing built research package export.");
}
const entry = join(root, researchExport.import);
const work = await mkdtemp(join(tmpdir(), "oh-research-browser-"));
try {
  const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
  // Keep every public export reachable so tree shaking cannot conceal a Node
  // import in a less common codec, compiler, or domain catalog path.
  const browser = await Bun.build({ entrypoints: [entry], target: "browser", format: "esm",
    plugins: [{ name: "reject-platform-imports", setup(build) {
      build.onResolve({ filter: /.*/u }, (args) => {
        if (builtins.has(args.path) || args.path.startsWith("node:") || args.path.startsWith("bun:")) {
          throw new Error(`The pure research graph imports a platform module: ${args.path}`);
        }
        return undefined;
      });
    } }],
  });
  if (!browser.success || browser.outputs.length !== 1) throw new AggregateError(browser.logs, "The built research graph is not browser-portable.");
  const entrySource = join(work, "probe.ts");
  await writeFile(entrySource, `
import * as research from ${JSON.stringify(entry)};
globalThis.researchProbe = (async () => {
  if (typeof process !== "undefined" || typeof Buffer !== "undefined" || typeof Bun !== "undefined") throw new Error("A platform global leaked into the probe.");
  const entity = { entityId: "kent_aaaaaaaaaaaaaaaaaaaaaaaa", identityOperationId: "identity.browser-fixture",
    identityRevision: 1, redirectEntityId: null, state: "active", v: 1 };
  const source = await research.parseKnowledgeGraphRecordV1("entity", entity);
  if (!source.ok) throw new Error("Research entity parsing failed without platform globals.");
  const packet = await research.prepareOhResearchPacketV1({ records: [{ kind: "entity", value: entity }] });
  if (packet.authority !== "unasserted" || packet.records[0].value.source.recordSha256 !== source.value.recordSha256
    || packet.records[0].recordSha256 === source.value.recordSha256) throw new Error("Browser preparation changed source identity.");
  if (await research.verifyOhResearchPacketV1(JSON.parse(JSON.stringify(packet))) === null) throw new Error("Browser packet verification failed.");
  const catalog = await research.spongeKnowledgeDomainCatalogV3();
  const mappings = await research.spongeKnowledgeWikidataMappingCatalogV2();
  if (catalog.packs.length !== 18 || mappings.mappings.length !== 15) throw new Error("Missing source relationships in built browser export.");
  const deeper = await research.spongeKnowledgeDomainCatalogV5();
  const preserved = await research.spongeKnowledgeWikidataMappingCatalogV3();
  if (deeper.packs.length !== catalog.packs.length + 2
    || deeper.identityContextPack.packId !== "sponge.identity-context"
    || deeper.bridgeRelationsPack.packId !== "sponge.bridge-relations"
    || preserved.reviewedMappings.length !== mappings.mappings.length
    || preserved.preservedProperties.length !== 16
    || preserved.preservedProperties.some(property => property.target !== null)) {
    throw new Error("Missing ontology depth packs or preservation boundary in built browser export.");
  }
  const resolution = await research.resolveKnowledgeVocabularyPacksV1({ manifests: deeper.packs, roots: deeper.lock.roots });
  if (!resolution.ok || resolution.value.lock.lockSha256 !== deeper.lock.lockSha256) throw new Error("Depth catalog cannot resolve its complete dependency lock in the browser.");
  const input = { v: 2, properties: "all-present", mappingVersion: "browser-probe", captures: [{
    requestedId: "Q1", resolvedId: "Q1", sourceUri: "https://www.wikidata.org/w/api.php", redirects: [],
    capturedAt: "2026-09-13T00:00:00.000Z", coverage: { kind: "complete-entity" },
    body: JSON.stringify({ type: "item", id: "Q1", lastrevid: 1, claims: { P175: [{ id: "Q1$performer", type: "statement", rank: "normal",
      mainsnak: { property: "P175", datatype: "wikibase-item", snaktype: "value", datavalue: { type: "wikibase-entityid", value: { id: "Q5", "entity-type": "item", "numeric-id": 5 } } } }] } }) }] };
  const preview = await research.createKnowledgeWikidataMappingPreviewV2(input);
  if (!preview.ok || preview.value.candidates.length !== 1 || !(await research.verifyKnowledgeWikidataMappingPreviewV2(JSON.parse(JSON.stringify(preview.value)), input)).ok) {
    throw new Error("Source relationship preview did not round-trip using Web APIs only.");
  }
  return true;
})();
`);
  const probe = await Bun.build({ entrypoints: [entrySource], target: "browser", format: "iife" });
  if (!probe.success || probe.outputs.length !== 1) throw new AggregateError(probe.logs, "Research browser execution probe did not bundle.");
  await writeFile(join(work, "probe.js"), await probe.outputs[0]!.text());
  await writeFile(join(work, "execute.mjs"), `
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
const context = { crypto: webcrypto, TextEncoder, TextDecoder, URL };
runInNewContext(await readFile(new URL("./probe.js", import.meta.url), "utf8"), context, { timeout: 5000 });
assert.equal(await context.researchProbe, true);
`);
  const result = await runBoundedProcess(["node", join(work, "execute.mjs")], {
    cwd: work, env: publicReleaseEnvironment(), timeoutMs: 30_000, stdoutBytes: 16_384, stderrBytes: 32_768,
  });
  if (result.exitCode !== 0) throw new Error(`The research browser probe failed: ${result.stderr.toString("utf8")}`);
  console.log("Verified built research exports browser-bundle without platform modules and prepare exact packets using Web APIs only.");
} finally { await rm(work, { recursive: true, force: true }); }
