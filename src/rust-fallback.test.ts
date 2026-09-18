import { describe, expect, spyOn, test } from "bun:test";
import { emitOhRustFallback } from "./rust-fallback";

describe("emitOhRustFallback", () => {
  test("emits one bounded notice per tag, reason, and input class", () => {
    const write = spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      emitOhRustFallback({ tag: "oh-test-fallback-a", reason: "load-failed" });
      emitOhRustFallback({ tag: "oh-test-fallback-a", reason: "load-failed" });
      emitOhRustFallback({ tag: "oh-test-fallback-a", reason: "mismatch", inputClass: "object" });
      emitOhRustFallback({ tag: "oh-test-fallback-a", reason: "mismatch", inputClass: "object" });
      const lines = write.mock.calls.map((call) => String(call[0]));
      expect(lines).toEqual([
        "[oh-test-fallback-a] load-failed\n",
        "[oh-test-fallback-a] mismatch input=object\n",
      ]);
    } finally {
      write.mockRestore();
    }
  });

  test("caps distinct notices per tag at four", () => {
    const write = spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      for (let index = 0; index < 8; index += 1) {
        emitOhRustFallback({ tag: "oh-test-fallback-b", reason: `reason-${index}` });
      }
      expect(write.mock.calls.length).toBe(4);
    } finally {
      write.mockRestore();
    }
  });

  test("sanitizes unbounded fields to a closed diagnostic class", () => {
    const write = spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      emitOhRustFallback({
        tag: "oh-test-fallback-c",
        reason: "raw provider error with spaces and /private/path",
        inputClass: "x".repeat(128),
      });
      expect(write.mock.calls.map((call) => String(call[0]))).toEqual([
        "[oh-test-fallback-c] other input=other\n",
      ]);
    } finally {
      write.mockRestore();
    }
  });

  test("never throws when stderr write fails", () => {
    const write = spyOn(process.stderr, "write").mockImplementation(() => {
      throw new Error("closed stream");
    });
    try {
      expect(() => emitOhRustFallback({ tag: "oh-test-fallback-d", reason: "write-failed" })).not.toThrow();
    } finally {
      write.mockRestore();
    }
  });
});
