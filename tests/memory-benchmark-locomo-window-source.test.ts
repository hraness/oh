import { describe, expect, test } from "bun:test";
import { sha256Hex } from "../src/canonical";
import type { Corpus } from "../scripts/benchmarks/datasets";
import { prepareWindowIndex, selectWindowPolicies } from "../scripts/benchmarks/deductive-window-probe";
import { LOCOMO_WINDOW_CONFIRMATION, isLocomoWindowReaderEligible, locomoWindowConfirmationPins,
  projectLocomoWindowDraw, readLocomoWindowConfirmation, replayLocomoWindowContext,
  type AdmittedLocomoWindowConfirmation, type LocomoWindowContextRow } from "../scripts/benchmarks/locomo-window-source";
import { pack } from "../scripts/benchmarks/retrieval";

const corpus: Corpus = { id:"conv-26",groupId:"conv-26",turns:Array.from({length:100},(_,index) => ({
  id:`D${Math.floor(index/25)+1}:${index%25}`,sessionId:`session_${Math.floor(index/25)+1}`,
  date:index<75 ? "1 May 2023 at 1:00 pm" : "8 May 2023 at 4:21 pm",speaker:index%2 ? "Casey" : "Jordan",
  text:(index%7 ? `Original conversation about ceramics ${index}. ` : "Café hiking in mountains 🏔️. ").repeat(12),
})) };
const query = {id:"conv-26:0",corpusId:"conv-26",question:"What did Jordan say about hiking?"};
const vector = Array.from({length:20},(_,i) => corpus.turns[Math.floor(i/5)*25+(i%5)*4]!.id);
function fixture() {
  const selected = selectWindowPolicies(corpus,prepareWindowIndex(corpus),query.question,vector);
  const row = (arm:"vector-window"|"anchors-query-4"): LocomoWindowContextRow => {
    const got = selected.get(arm)!;
    return {questionId:query.id,corpusId:corpus.id,groupId:corpus.groupId,arm,turnIds:got.turnIds,
      contextBytes:Buffer.byteLength(got.context),contextSha256:sha256Hex(got.context),failure:null};
  };
  return {selected,control:row("vector-window"),candidate:row("anchors-query-4")};
}

describe("frozen LoCoMo reader source boundary", () => {
  test("reproduces exact whole-turn contexts and original speakers/final-session anchor without gold", () => {
    const {selected,control,candidate}=fixture();
    const poisoned = Object.defineProperties({...query},{answer:{get(){throw Error("answer inspected");}},
      evidenceTurnIds:{get(){throw Error("evidence inspected");}},category:{get(){throw Error("category inspected");}}});
    const result=replayLocomoWindowContext(corpus,poisoned,vector,control,candidate);
    expect(Object.keys(result).sort()).toEqual(["contexts","groupId","id","question","questionDate"]);
    expect(result.questionDate).toBe("8 May 2023 at 4:21 pm");
    expect(result.question).toBe(query.question);
    for(const context of result.contexts) {
      expect(context.text).toBe(selected.get(context.armId)!.context);
      expect(context.contextSha256).toBe(sha256Hex(context.text));
      expect(Buffer.byteLength(context.text)).toBeLessThanOrEqual(12000);
      expect(context.text).toContain("Jordan:");
      const replay=pack(context.turnIds.map(id=>({turn:corpus.turns.find(turn=>turn.id===id)!})),12000);
      expect(context.text).toBe(replay.context);
      expect(Object.keys(context).sort()).toEqual(["armId","contextSha256","text","turnIds"]);
    }
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.contexts[0]!.turnIds)).toBe(true);
  });
  test("refuses changed confirmed context hashes, ordered turns, row identity and failure disposition", () => {
    const {control,candidate}=fixture();
    expect(()=>replayLocomoWindowContext(corpus,query,vector,{...control,contextSha256:"0".repeat(64)},candidate)).toThrow("bytes changed");
    expect(()=>replayLocomoWindowContext(corpus,query,vector,control,{...candidate,contextBytes:candidate.contextBytes-1})).toThrow("bytes changed");
    expect(()=>replayLocomoWindowContext(corpus,query,vector,control,{...candidate,turnIds:[...candidate.turnIds].reverse()})).toThrow("turn order");
    expect(()=>replayLocomoWindowContext(corpus,query,vector,control,{...candidate,groupId:"conv-30"})).toThrow("identity");
    expect(()=>replayLocomoWindowContext(corpus,query,vector,control,{...candidate,failure:"old failure"})).toThrow("failure");
    expect(()=>replayLocomoWindowContext(corpus,{...query,corpusId:"conv-30"},vector,control,candidate)).toThrow("corpus identity");
  });
  test("refuses missing/duplicate/unknown original top20 ranks and absent final-session time", () => {
    const {control,candidate}=fixture();
    for(const bad of [vector.slice(1),[...vector.slice(1),vector[1]!],[...vector.slice(1),"unknown"]]) {
      expect(()=>replayLocomoWindowContext(corpus,query,bad,control,candidate)).toThrow("complete unique top-20");
    }
    const blankDates={...corpus,turns:corpus.turns.map(turn=>({...turn,date:""}))};
    const selected=selectWindowPolicies(blankDates,prepareWindowIndex(blankDates),query.question,vector);
    const adjust=(row:LocomoWindowContextRow) => ({...row,turnIds:selected.get(row.arm as "vector-window")!.turnIds,
      contextSha256:sha256Hex(selected.get(row.arm as "vector-window")!.context),contextBytes:Buffer.byteLength(selected.get(row.arm as "vector-window")!.context)});
    expect(()=>replayLocomoWindowContext(blankDates,query,vector,adjust(control),adjust(candidate))).toThrow("timestamp");
  });
  test("native J membership keeps categories1–4 even with no evidence; excludes category5 and development", () => {
    const noLabels=Object.defineProperties({corpusId:"conv-26",category:"locomo:2",unanswerable:false},
      {answer:{get(){throw Error("answer inspected");}},evidenceTurnIds:{get(){throw Error("evidence inspected");}}});
    expect(isLocomoWindowReaderEligible(noLabels)).toBe(true);
    for(const category of ["locomo:1","locomo:2","locomo:3","locomo:4"]) expect(isLocomoWindowReaderEligible({...noLabels,category})).toBe(true);
    expect(isLocomoWindowReaderEligible({...noLabels,category:"locomo:5"})).toBe(false);
    expect(isLocomoWindowReaderEligible({...noLabels,unanswerable:true})).toBe(false);
    expect(isLocomoWindowReaderEligible({...noLabels,corpusId:"conv-49"})).toBe(false);
    expect(isLocomoWindowReaderEligible({...noLabels,corpusId:"conv-50"})).toBe(false);
  });
  test("fixed role pins reject substituted studies and aliases before reading any input", async () => {
    const pins=locomoWindowConfirmationPins("/nonexistent/frozen","/nonexistent/development.json");
    expect(pins.confirmationPin.sha256).toBe(LOCOMO_WINDOW_CONFIRMATION.resultFileSha256);
    await expect(readLocomoWindowConfirmation({...pins,confirmationPin:{...pins.confirmationPin,sha256:"0".repeat(64)}})).rejects.toThrow("unreviewed");
    await expect(readLocomoWindowConfirmation({...pins,developmentPin:{...pins.developmentPin,path:pins.confirmationPin.path}})).rejects.toThrow("aliased");
    await expect(readLocomoWindowConfirmation({...pins,extra:true} as typeof pins)).rejects.toThrow("roles");
  });
  test("draw projection requires the authenticated in-process source admission", () => {
    expect(()=>projectLocomoWindowDraw({} as AdmittedLocomoWindowConfirmation,[])).toThrow("authenticated admission");
  });
});
