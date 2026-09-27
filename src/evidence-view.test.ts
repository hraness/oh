import { describe, expect, test } from "bun:test";
import { canonicalJson, utf8ByteLength } from "./canonical";
import { createKnowledgeGraphRecordV1, type KnowledgeGraphRecordV1 } from "./graph";
import { buildOhEvidenceViewV1, compareOhEvidenceEventsV1, currentOhEvidenceStateV1,
  groupOhEvidenceEventsV1, renderOhEvidenceViewIndexV1, OH_EVIDENCE_VIEW_LIMITS_V1,
  type OhEvidenceCitationV1, type OhEvidenceLinkV1, type OhEvidenceMentionV1 } from "./evidence-view";

// Frozen scenario families and causal invariants precede implementation in docs/evidence-view.md.
const instant = (day: number) => `2032-04-${String(day).padStart(2, "0")}T12:00:00.000Z`;
function record(id: string, text: string, day = 10, speaker = "Mira"): KnowledgeGraphRecordV1 {
  return createKnowledgeGraphRecordV1({ key: `edition:${id}`, kind: "edition", dependencies: [], v: 1,
    value: { text, speaker, observedAt: instant(day) } });
}
function cite(source: KnowledgeGraphRecordV1, quote?: string): OhEvidenceCitationV1 {
  return { key: source.key, recordSha256: source.recordSha256, quote: quote ?? (source.value as { text: string }).text };
}
function mention(id: string, source: KnowledgeGraphRecordV1, kind: OhEvidenceMentionV1["kind"] = "state",
  timeExpression: string | null = null): OhEvidenceMentionV1 {
  return { id, source: cite(source), kind, timeExpression };
}
function link(id: string, kind: OhEvidenceLinkV1["kind"], from: string, to: string, source: KnowledgeGraphRecordV1): OhEvidenceLinkV1 {
  return { id, kind, from, to, source: cite(source) };
}
function visits() {
  const scheduled = record("scheduled", "Mira plans a telescope visit on 2032-05-04.", 1);
  const cancelled = record("cancelled", "Mira cancelled that telescope visit.", 2);
  const restored = record("restored", "Mira reactivated the previously cancelled telescope visit.", 3);
  const records = [scheduled, cancelled, restored];
  const mentions = [mention("scheduled", scheduled, "plan", "2032-05-04"), mention("cancelled", cancelled, "plan"), mention("restored", restored, "plan")];
  const links = [link("cancellation", "cancels", "cancelled", "scheduled", cancelled), link("restoration", "reactivates", "restored", "cancelled", restored)];
  return { records, mentions, links };
}

describe("source-linked evidence views", () => {
  test("keeps cancellation/reactivation history and selects by statement time", () => {
    const view = buildOhEvidenceViewV1(visits());
    const at = (day: number) => currentOhEvidenceStateV1(view, "scheduled", instant(day));
    expect(at(1).status).toBe("supported");
    expect(at(1).current.map((item) => [item.mention.id, item.state])).toEqual([["scheduled", "active"]]);
    expect(at(2).current.map((item) => [item.mention.id, item.state])).toEqual([["cancelled", "cancelled"]]);
    expect(at(3).current.map((item) => [item.mention.id, item.state])).toEqual([["restored", "active"]]);
    expect(at(3).history).toHaveLength(3);
    expect(view.sources.map((item) => item.text).sort()).toEqual(visits().records.map((item) => (item.value as { text: string }).text).sort());
    expect(view.mentions.find((item) => item.id === "scheduled")?.interval?.since).toBe("2032-05-04T00:00:00.000Z");
  });

  test("storage permutation, ranked wrappers, and unrelated insertion preserve supported operations", () => {
    const input = visits(), expected = currentOhEvidenceStateV1(buildOhEvidenceViewV1(input), "scheduled");
    for (const shift of [0, 1, 2]) {
      const records = [...input.records.slice(shift), ...input.records.slice(0, shift), record("noise", "Zed watered a fern.")].reverse();
      const view = buildOhEvidenceViewV1({ ...input, records: records.map((item) => ({ record: item })), links: [...input.links].reverse() });
      expect(currentOhEvidenceStateV1(view, "scheduled")).toEqual(expected);
    }
  });

  test("competing explicit corrections preserve both terminal values", () => {
    const input = visits(), competing = record("competing", "Mira moved the telescope visit to the observatory.", 3);
    const view = buildOhEvidenceViewV1({ records: [...input.records, competing], mentions: [...input.mentions, mention("competing", competing, "plan")],
      links: [...input.links, link("competing-change", "supersedes", "competing", "cancelled", competing)] });
    const result = currentOhEvidenceStateV1(view, "scheduled");
    expect(result.status).toBe("unresolved");
    expect(result.reasons).toContain("competing-current-statements");
    expect(result.current.map((item) => item.mention.id)).toEqual(["competing", "restored"]);
  });

  test("shared wording and suggestions create no correction or adoption", () => {
    const plan = record("plan", "Mira plans to visit the observatory."), suggestion = record("suggestion", "You could visit the observatory.", 11, "assistant");
    const view = buildOhEvidenceViewV1({ records: [plan, suggestion], mentions: [mention("plan", plan, "plan"), mention("suggestion", suggestion, "suggestion")] });
    expect(view.links).toEqual([]);
    expect(currentOhEvidenceStateV1(view, "plan").current.map((item) => item.mention.id)).toEqual(["plan"]);
    expect(currentOhEvidenceStateV1(view, "suggestion").status).toBe("unresolved");
    expect(view.sources.find((source) => source.record.key === suggestion.key)?.speaker).toBe("assistant");
  });

  test("removing sole support, changing the digest, or forging a quote cannot retain a supported state", () => {
    const source = record("only", "Mira chose the blue telescope."), pointer = mention("only", source);
    const missing = buildOhEvidenceViewV1({ records: [], mentions: [pointer] });
    expect(currentOhEvidenceStateV1(missing, "only").status).toBe("unsupported");
    expect(missing.mentions[0]?.support).toBe("missing-source");
    const stale = buildOhEvidenceViewV1({ records: [record("only", "Mira chose the red telescope.")], mentions: [pointer] });
    expect(stale.mentions[0]?.support).toBe("stale-source");
    const forged = buildOhEvidenceViewV1({ records: [source], mentions: [{ ...pointer, source: { ...pointer.source, quote: "purple telescope" } }] });
    expect(forged.mentions[0]?.support).toBe("quote-mismatch");
    expect(currentOhEvidenceStateV1(forged, "only").status).toBe("unsupported");
  });

  test("missing correction support reports an unresolved chain and keeps supported earlier evidence", () => {
    const input = visits(), view = buildOhEvidenceViewV1({ ...input, records: input.records.slice(0, 1) });
    const result = currentOhEvidenceStateV1(view, "scheduled");
    expect(result.status).toBe("unresolved");
    expect(result.current.map((item) => item.mention.id)).toEqual(["scheduled"]);
    expect(result.history).toHaveLength(3);
  });

  test("repeated mentions group only by explicit same-event links and preserve distinct-event conflicts", () => {
    const first = record("first", "Mira visited the museum yesterday."), repeat = record("repeat", "That was the same museum visit."), second = record("second", "Mira made a separate museum visit.");
    const input = { records: [first, repeat, second], mentions: [mention("a", first, "event", "yesterday"), mention("b", repeat, "event"), mention("c", second, "event")],
      links: [link("same", "same-event", "a", "b", repeat), link("distinct", "distinct-event", "a", "c", second)] };
    expect(groupOhEvidenceEventsV1(buildOhEvidenceViewV1(input))).toEqual({ groups: [["a", "b"], ["c"]], conflicts: [], unlinked: ["c"] });
    const conflict = groupOhEvidenceEventsV1(buildOhEvidenceViewV1({ ...input, links: [...input.links, link("contradiction", "distinct-event", "b", "a", repeat)] }));
    expect(conflict.conflicts).toEqual(["contradiction"]);
    expect(groupOhEvidenceEventsV1(buildOhEvidenceViewV1({ ...input, links: [] })).unlinked).toEqual(["a", "b", "c"]);
  });

  test("event dates and statement dates vary independently", () => {
    const evaluate = (day: number, eventDate: string) => {
      const source = record("visit", `Mira visited on ${eventDate}.`, day);
      return buildOhEvidenceViewV1({ records: [source], mentions: [mention("visit", source, "event", eventDate)] }).mentions[0]!;
    };
    const a = evaluate(10, "2032-03-01"), movedStatement = evaluate(11, "2032-03-01"), movedEvent = evaluate(10, "2032-03-02");
    expect(a.interval).toEqual(movedStatement.interval);
    expect(a.statedAt).not.toBe(movedStatement.statedAt);
    expect(a.statedAt).toBe(movedEvent.statedAt);
    expect(a.interval).not.toEqual(movedEvent.interval);
    const relative = record("relative", "Mira visited yesterday.", 10);
    expect(buildOhEvidenceViewV1({ records: [relative], mentions: [mention("r", relative, "event", "yesterday")] }).mentions[0]?.interval?.since).toBe("2032-04-09T00:00:00.000Z");
  });

  test("intervals establish only supported partial order, retaining overlap and ambiguous dates", () => {
    const a = record("a", "Mira visited yesterday."), b = record("b", "Mira will visit tomorrow."), c = record("c", "Mira visited last week."), d = record("d", "Mira said yesterday or tomorrow.");
    const view = buildOhEvidenceViewV1({ records: [a, b, c, d], mentions: [mention("a", a, "event", "yesterday"), mention("b", b, "event", "tomorrow"),
      mention("c", c, "event", "last week"), mention("d", d, "event", "yesterday or tomorrow")] });
    expect(compareOhEvidenceEventsV1(view, "a", "b").relation).toBe("before");
    expect(compareOhEvidenceEventsV1(view, "b", "a").relation).toBe("after");
    expect(compareOhEvidenceEventsV1(view, "a", "d").relation).toBe("unknown");
    expect(compareOhEvidenceEventsV1(view, "a", "a").relation).toBe("unknown");
    expect(compareOhEvidenceEventsV1(view, "a", "missing").relation).toBe("unsupported");
    expect(view.mentions.find((item) => item.id === "d")?.timeStatus).toBe("ambiguous");
    const overlap = record("overlap", "Mira visited this month.");
    const overlapping = buildOhEvidenceViewV1({ records: [a, overlap], mentions: [mention("a", a, "event", "yesterday"), mention("o", overlap, "event", "this month")] });
    expect(compareOhEvidenceEventsV1(overlapping, "a", "o").relation).toBe("unknown");
  });

  test("unknown grammar, embedded matches, and unquoted expressions never become a forced event date", () => {
    for (const expression of ["around spring", "since last week", "maybe tomorrow", "before yesterday"]) {
      const source = record("vague", `Mira visited ${expression}.`);
      const view = buildOhEvidenceViewV1({ records: [source], mentions: [mention("v", source, "event", expression)] });
      expect(view.mentions[0]?.interval).toBeNull();
    }
    const source = record("none", "Mira visited the museum.");
    expect(buildOhEvidenceViewV1({ records: [source], mentions: [mention("v", source, "event", "yesterday")] }).mentions[0]?.timeStatus).toBe("unsupported");
  });

  test("cyclic and date-conflicting ordering links remain unresolved", () => {
    const a = record("a", "Mira visited yesterday."), b = record("b", "Mira visited tomorrow."), relation = record("relation", "The first visit preceded the second.");
    const base = { records: [a, b, relation], mentions: [mention("a", a, "event", "yesterday"), mention("b", b, "event", "tomorrow")] };
    const reversed = link("reversed", "before", "b", "a", relation), forward = link("forward", "before", "a", "b", relation);
    expect(compareOhEvidenceEventsV1(buildOhEvidenceViewV1({ ...base, links: [reversed] }), "a", "b").relation).toBe("conflict");
    expect(compareOhEvidenceEventsV1(buildOhEvidenceViewV1({ ...base, links: [reversed, forward] }), "a", "b").relation).toBe("conflict");
    const input = visits();
    const state = currentOhEvidenceStateV1(buildOhEvidenceViewV1({ ...input,
      links: [...input.links, link("cycle", "supersedes", "scheduled", "restored", input.records[0]!)] }), "scheduled");
    expect(state.status).toBe("unresolved");
    expect(state.reasons).toContain("cyclic-links");
  });

  test("future link evidence cannot silently change historical state", () => {
    const a = record("a", "Mira chose the north site.", 1), b = record("b", "Mira chose the south site.", 2), later = record("later", "The south choice replaced the north choice.", 8);
    const input = { records: [a, b, later], mentions: [mention("a", a), mention("b", b)] };
    const baseline = currentOhEvidenceStateV1(buildOhEvidenceViewV1(input), "a", instant(4));
    const view = buildOhEvidenceViewV1({ ...input, links: [link("change", "supersedes", "b", "a", later)] });
    expect(baseline.status).toBe("supported");
    expect(baseline.current.map((item) => item.mention.id)).toEqual(["a"]);
    expect(currentOhEvidenceStateV1(view, "a", instant(4))).toEqual(baseline);
    expect(currentOhEvidenceStateV1(view, "a", instant(9)).current.map((item) => item.mention.id)).toEqual(["b"]);
    expect(view.links).toHaveLength(1); expect(view.mentions).toHaveLength(2);
  });

  test("unknown link statement times remain explicitly unresolved in historical queries", () => {
    const a = record("a", "Mira chose the north site.", 1), b = record("b", "Mira chose the south site.", 2);
    const undated = createKnowledgeGraphRecordV1({ key: "edition:undated", kind: "edition", dependencies: [], v: 1,
      value: { text: "The south choice replaced the north choice." } });
    const view = buildOhEvidenceViewV1({ records: [a, b, undated], mentions: [mention("a", a), mention("b", b)],
      links: [link("change", "supersedes", "b", "a", undated)] });
    const result = currentOhEvidenceStateV1(view, "a", instant(4));
    expect(result.status).toBe("unresolved");
    expect(result.reasons).toContain("unknown-link-statement-time");
    expect(result.current.map((item) => item.mention.id)).toEqual(["a", "b"]);
  });

  test("non-event mentions cannot establish event order or bridge an event-order path", () => {
    const a = record("a", "Mira visited on 2032-05-04."), b = record("b", "Mira considered 2032-05-02."), c = record("c", "Jules visited on 2032-05-04.");
    for (const kind of ["state", "plan", "suggestion", "unclear"] as const) {
      const view = buildOhEvidenceViewV1({ records: [a, b, c], mentions: [mention("a", a, "event", "2032-05-04"),
        mention("b", b, kind, "2032-05-02"), mention("c", c, "event", "2032-05-04")],
        links: [link("a-b", "before", "a", "b", a), link("b-c", "before", "b", "c", c)] });
      expect(compareOhEvidenceEventsV1(view, "a", "b").relation).toBe("unsupported");
      expect(compareOhEvidenceEventsV1(view, "b", "a").relation).toBe("unsupported");
      expect(compareOhEvidenceEventsV1(view, "a", "c").relation).toBe("unknown");
    }
  });

  test("raw-only input emits source-linked dates without asserting an event, and preserves raw bytes", () => {
    const source = record("raw", "YESTERDAY, Mira discussed a visit; tomorrow is a suggestion.", 10, "assistant");
    const original = canonicalJson(source), view = buildOhEvidenceViewV1({ records: [source] });
    expect(view.mentions).toEqual([]); expect(view.links).toEqual([]);
    expect(canonicalJson(view.sources[0]?.record)).toBe(original);
    expect(Object.isFrozen(source)).toBe(false);
    const index = renderOhEvidenceViewIndexV1(view);
    const rendered = JSON.parse(index.text);
    expect(rendered.coverage).toBe("partial");
    expect(rendered.dateMeaning).toBe("source-expressions-without-event-association");
    expect(rendered.sources[0].dates.map((item: { expression: string }) => item.expression)).toEqual(["yesterday", "tomorrow"]);
    expect(rendered.sources[0].quote).toBe(cite(source).quote);
    expect(rendered.sources[0].speaker).toBe("assistant");
    expect(index.bytes).toBe(utf8ByteLength(index.text));
  });

  test("whole-annotation byte budgets report omission without changing raw records", () => {
    const input = visits(), unicode = record("unicode", "Mira said: café 🔭 yesterday.", 10);
    const view = buildOhEvidenceViewV1({ ...input, records: [...input.records, unicode] }), raw = canonicalJson(view.sources);
    for (const budget of [512, 768, 1024, 4096, 16384]) {
      const rendered = renderOhEvidenceViewIndexV1(view, budget), decoded = JSON.parse(rendered.text);
      expect(rendered.bytes).toBeLessThanOrEqual(budget);
      expect(decoded.sources.length + rendered.omitted.sources).toBe(view.sources.length);
      expect(decoded.mentions.length + rendered.omitted.mentions).toBe(view.mentions.length);
      expect(decoded.links.length + rendered.omitted.links).toBe(view.links.length);
      const ids = new Set(decoded.mentions.map((item: { id: string }) => item.id));
      for (const item of decoded.links) { expect(ids.has(item.from)).toBe(true); expect(ids.has(item.to)).toBe(true); }
      expect(canonicalJson(view.sources)).toBe(raw);
    }
  });

  test("rejects malformed envelopes and excessive work before interpretation", () => {
    const source = record("one", "Mira chose a telescope."), m = mention("m", source);
    expect(() => buildOhEvidenceViewV1({ records: [source, source] })).toThrow("duplicate source key");
    expect(() => buildOhEvidenceViewV1({ records: [source], mentions: [m, m] })).toThrow("duplicate id");
    expect(() => buildOhEvidenceViewV1({ records: [source], mentions: [{ ...m, extra: true } as OhEvidenceMentionV1] })).toThrow("mention fields");
    expect(() => buildOhEvidenceViewV1({ records: [], mentions: Array(OH_EVIDENCE_VIEW_LIMITS_V1.mentions + 1).fill(m) })).toThrow("mentions bound");
    expect(() => buildOhEvidenceViewV1({ records: [source], sourceView: () => ({ text: cite(source).quote, statedAt: "2032-04-01", speaker: null }) })).toThrow("canonical statement instant");
    expect(() => buildOhEvidenceViewV1({ records: [source], sourceView: () => ({ text: "fabricated text", statedAt: null, speaker: null }) })).toThrow("preserve raw text");
    expect(() => renderOhEvidenceViewIndexV1(buildOhEvidenceViewV1({ records: [] }), 511)).toThrow("index byte budget");
    let called = false;
    const bad = { ...m, get source() { called = true; return cite(source); } };
    expect(() => buildOhEvidenceViewV1({ records: [source], mentions: [bad] })).toThrow("mention data fields");
    expect(called).toBe(false);
  });

  test("expensive raw date scans report their limit without altering explicit supported pointers", () => {
    const source = record("long", `Mira will visit tomorrow. ${"noise ".repeat(800)}`);
    const pointer = { ...mention("long", source, "event", "tomorrow"), source: cite(source, "Mira will visit tomorrow.") };
    const view = buildOhEvidenceViewV1({ records: [source], mentions: [pointer] });
    expect(view.sources[0]?.dateStatus).toBe("scan-limit");
    expect(view.sources[0]?.dateExpressions).toEqual([]);
    expect(view.mentions[0]?.interval?.since).toBe("2032-04-11T00:00:00.000Z");
    expect(JSON.parse(renderOhEvidenceViewIndexV1(view).text).sources[0].dateStatus).toBe("scan-limit");
  });

  test("raw annotation quotes survive Unicode case folding and excluded earlier occurrences", () => {
    const source = record("fold", "İris considered dates before yesterday, then visited YESTERDAY.");
    const rendered = JSON.parse(renderOhEvidenceViewIndexV1(buildOhEvidenceViewV1({ records: [source] })).text);
    expect(rendered.sources[0].quote).toBe(cite(source).quote);
    expect(rendered.sources[0].dates).toHaveLength(1);
    expect(rendered.sources[0].dates[0].since).toBe("2032-04-09T00:00:00.000Z");
  });

  test("date-bearing sources take priority over no-expression metadata under the same budget", () => {
    const dated = record("z-dated", "Mira visited yesterday."), noise = Array.from({ length: 12 }, (_, index) => record(`a-noise-${index}`, "A fern grows."));
    const view = buildOhEvidenceViewV1({ records: [...noise, dated] });
    const enoughForDated = renderOhEvidenceViewIndexV1(buildOhEvidenceViewV1({ records: [dated] }), 4096).bytes + 2;
    const rendered = renderOhEvidenceViewIndexV1(view, enoughForDated), decoded = JSON.parse(rendered.text);
    expect(decoded.sources.map((item: { key: string }) => item.key)).toEqual([dated.key]);
    expect(rendered.omitted.sources).toBe(noise.length);
    expect(rendered.bytes).toBeLessThanOrEqual(enoughForDated);
  });
});
