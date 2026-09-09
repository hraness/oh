import { isPlainRecord, parseSha256Hex, sha256Hex } from "../../src/canonical";
import { MAX_REPORT_BYTES, writeJson } from "./io";

export function summarizeReport(value: unknown, fullReportSha256: string) {
  if (!isPlainRecord(value) || value.protocol !== "oh.memory-benchmark.v1" || !isPlainRecord(value.manifest)
    || !isPlainRecord(value.manifest.code) || parseSha256Hex(value.manifest.code.sourceSha256) === null
    || parseSha256Hex(fullReportSha256) === null || (value.summaries === undefined
      && !(value.manifest.command === "extract" && isPlainRecord(value.extraction)))) {
    throw new TypeError("Not a recognized benchmark report.");
  }
  const fields = ["protocol", "createdAt", "manifest", "status", "stopped", "summaries", "comparisons", "ingestion",
    "unresolvedEvidence", "unresolvedReferences", "evidenceProtocol", "evidenceNormalization",
    "resultSha256", "qualifications", "provider", "spend", "phaseAccounting", "sourceReport", "judgeProtocol", "judgeProfile", "judgeExecution", "queryOrder", "memoryUnits", "extraction"];
  return { ...Object.fromEntries(fields.filter((field) => Object.hasOwn(value, field)).map((field) => [field, value[field]])),
    fullReportSha256 };
}

export async function exportSummary(input: string, output: string) {
  const file = Bun.file(input);
  if (!await file.exists() || file.size < 1 || file.size > MAX_REPORT_BYTES) throw new Error("Report must be an existing file of at most 128 MiB.");
  const bytes = await file.bytes();
  let value: unknown;
  try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error("Report is not JSON."); }
  const summary = summarizeReport(value, sha256Hex(bytes));
  await writeJson(output, summary);
  return summary.fullReportSha256;
}
