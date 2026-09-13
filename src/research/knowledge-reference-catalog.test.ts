import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { spongeKnowledgeReferenceCatalog } from "./knowledge-reference-catalog";

const kernelFiles = new Set([
  "knowledge-ontology-v1", "knowledge-ontology-contract-v1", "knowledge-core-v1",
  "knowledge-declarative-json", "knowledge-vocabulary-pack-v1", "knowledge-domain-catalog",
  "knowledge-value-codecs-v1", "knowledge-reference-catalog", "document-domain", "integrity-domain",
  "unknown", "record-input",
]);
async function importsOf(name: string): Promise<readonly string[]> {
  const source = await readFile(new URL(`./${name}.ts`, import.meta.url), "utf8");
  const parsed = ts.createSourceFile(`${name}.ts`, source, ts.ScriptTarget.Latest, true);
  const imports: string[] = [];
  function visit(node: ts.Node): void {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) imports.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const specifier = node.arguments[0];
      expect(specifier !== undefined && ts.isStringLiteral(specifier)).toBe(true);
      if (specifier !== undefined && ts.isStringLiteral(specifier)) imports.push(specifier.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  return imports;
}

test("the portable kernel has only explicit local dependencies and no private application or provider imports", async () => {
  for (const name of kernelFiles) {
    for (const specifier of await importsOf(name)) {
      expect(specifier.startsWith("./")).toBe(true);
      expect(kernelFiles.has(specifier.slice(2).replace(/\.(?:js|ts)$/u, ""))).toBe(true);
    }
  }
});

test("source codecs load only the reference foundation without initializing fourteen domain profiles", async () => {
  const reached = new Set<string>();
  const pending = ["knowledge-value-codecs-v1"];
  while (pending.length > 0) {
    const name = pending.pop()!;
    if (reached.has(name)) continue;
    reached.add(name);
    for (const specifier of await importsOf(name)) pending.push(specifier.slice(2).replace(/\.(?:js|ts)$/u, ""));
  }
  expect(reached.has("knowledge-domain-catalog")).toBe(false);
  expect(reached.has("knowledge-reference-catalog")).toBe(true);
  const reference = await spongeKnowledgeReferenceCatalog();
  expect(reference.referencePack.schemas).toHaveLength(14);
  expect(reference.referencePack.sources[0]?.license).toBe("MIT");
  expect(Object.isFrozen(reference.referencePack.schemas)).toBe(true);
});
