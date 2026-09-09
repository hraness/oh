import { describe, expect, test } from "bun:test";
import { assessSuperiority, CONFIRMATION_SYSTEMS } from "../scripts/benchmarks/superiority";
const selected = Array.from({length:20},(_,i)=>({questionId:"q"+i,corpusId:"c"+i,groupId:"g"+i}));
const matrix = (candidate:number, baseline:number) => selected.flatMap(x=>CONFIRMATION_SYSTEMS.map(system=>({...x,system,
  status:"completed",correct:system==="oh-fact"?candidate:baseline})));
describe("frozen confirmation decision",()=>{
  test("requires improvement over both predeclared controls",()=>{
    expect(assessSuperiority(20,selected,matrix(1,0)).established).toBe(true);
    const rows=matrix(1,0).map(x=>x.system==="bm25-record-window"?{...x,correct:1}:x);
    expect(assessSuperiority(20,selected,rows).established).toBe(false);
    expect(assessSuperiority(20,selected,matrix(0,1)).established).toBe(false);
  });
  test("does not certify missing or failed judgments",()=>{
    expect(assessSuperiority(20,selected,matrix(1,0).slice(1))).toMatchObject({status:"incomplete",established:false});
    const rows:unknown[]=matrix(1,0);rows[0]={...selected[0],system:"oh-fact",status:"judge-error",correct:null};
    expect(assessSuperiority(20,selected,rows)).toMatchObject({status:"incomplete",established:false,
      coverage:{missingOrFailed:1}});
  });
  test("rejects duplicated, swapped, nonbinary and foreign rows",()=>{
    const rows=matrix(1,0);
    for(const bad of [rows[1], {...rows[0],groupId:"wrong"}, {...rows[0],correct:0.5},
      {...rows[0],system:"bm25-fact"}, {...rows[0],questionId:"other"}]){
      expect(()=>assessSuperiority(20,selected,[bad,...rows.slice(1)])).toThrow();
    }
    expect(()=>assessSuperiority(20,[selected[0]!,selected[0]!],[])).toThrow();
  });
});

test("rejects missing selected identities before matching rows",()=>{
  expect(()=>assessSuperiority(1,[{questionId:"q"}] as any, CONFIRMATION_SYSTEMS.map(system=>({questionId:"q",system,
    status:"completed",correct:system==="oh-fact"?1:0})))).toThrow();
});
