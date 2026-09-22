import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { sha256Hex } from "../src/canonical";
import { CONFIRM_ALPHA, FUSION_DEV_POLICY_SHA256, FUSION_DEV_RESULT_SHA256,
  FUSION_DEV_SOURCE, FUSION_DEV_SOURCE_SHA256, validateDevelopmentSelection,
} from "../scripts/benchmarks/deductive-fusion-confirm";
import { ROOT } from "../scripts/benchmarks/io";

const developmentBytes = readFileSync(join(ROOT, FUSION_DEV_SOURCE));
const development = () => JSON.parse(developmentBytes.toString());

describe("frozen fusion confirmation admission", () => {
  test("pins the exact development bytes, result, policy, and one selected weight", () => {
    expect(sha256Hex(developmentBytes)).toBe(FUSION_DEV_SOURCE_SHA256);
    const admitted = validateDevelopmentSelection(development());
    expect(admitted.resultSha256).toBe(FUSION_DEV_RESULT_SHA256);
    expect(admitted.policySha256).toBe(FUSION_DEV_POLICY_SHA256);
    expect(admitted.winner).toEqual({ arm: "fusion-0.5", structuralWeight: CONFIRM_ALPHA });
    expect(CONFIRM_ALPHA).toBe(0.5);
  });

  test("rejects modified outcomes, policy, winner, and upstream provenance", () => {
    const rowChange = development();
    rowChange.rows[0].turnIds.reverse();
    expect(() => validateDevelopmentSelection(rowChange)).toThrow("development result changed");
    const policyChange = development();
    policyChange.policy.rrfK = 30;
    expect(() => validateDevelopmentSelection(policyChange)).toThrow("development policy changed");
    const winnerChange = development();
    winnerChange.winner.structuralWeight = 0.25;
    expect(() => validateDevelopmentSelection(winnerChange)).toThrow("winner or source changed");
    const sourceChange = development();
    sourceChange.source.sha256 = "0".repeat(64);
    expect(() => validateDevelopmentSelection(sourceChange)).toThrow("winner or source changed");
  });
});
