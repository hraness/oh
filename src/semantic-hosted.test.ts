import {expect,test} from "bun:test";
import {canonicalSha256,sha256Hex} from "./canonical";
import {createKnowledgeGraphRecordV1,type KnowledgeGraphRecordV1} from "./graph";
import {recordDocument} from "./semantic-model";
import {OhSqliteStore} from "./sqlite/store";
import {OhHostedSemanticBackendV2} from "./semantic-hosted";
import {OH_HOSTED_PROFILE_SHA256_V2,OH_HOSTED_EMBEDDING_PROFILE_V2,hostedDocumentChunksV1,hostedQueryV1,hostedRecordsV1,hostedSourceSha256V1,
 normalizeOhHostedEmbeddingV2,parseOhHostedSettlementV1,parseOhHostedSnapshotV1,type OhHostedSnapshotV1,type OhHostedSettlementV1} from "./semantic-hosted-model";
const vector=(a:number,b=0)=>normalizeOhHostedEmbeddingV2(Array.from({length:1536},(_,i)=>i===0?a:i===1?b:0));
const make=(key:string,text:string)=>createKnowledgeGraphRecordV1({key,kind:"entity",dependencies:[],v:1,value:{text}});
const sources=[make("entity:a","A source paragraph with 🍇".repeat(240)),make("entity:b","The synthetic bicycle is turquoise.")];
const query="Which synthetic source?",otherQuery="Another synthetic query?";
function fixture(){
 const records=hostedRecordsV1(sources),chunks=records.flatMap(r=>hostedDocumentChunksV1(r));
 const receipt=(role:"document"|"query",inputs:readonly string[]):OhHostedSettlementV1=>({authoritySha256:sha256Hex("authority"),settlementSha256:sha256Hex("settlement-"+role),
 requestSha256:sha256Hex("request-"+role),responseSha256:sha256Hex("response-"+role),profileSha256:OH_HOSTED_PROFILE_SHA256_V2,role,inputSha256s:inputs.map(sha256Hex),
 knownCostMicros:2,reservationMicros:10,latencyMs:1.25,physicalCalls:1});
 const receipts=[receipt("document",chunks.map(c=>c.input)),receipt("query",[query,otherQuery])];
 let offset=0;
 const projected=records.map((record,r)=>{const parts=hostedDocumentChunksV1(record);const out={key:record.key,recordSha256:record.recordSha256,documentSha256:sha256Hex(recordDocument(record)),
 chunks:parts.map(c=>({start:c.start,end:c.end,inputSha256:c.inputSha256,embeddingIndex:offset++}))};return out;});
 const embeddings=chunks.map((c,i)=>({role:"document" as const,inputSha256:c.inputSha256,vector:i===0?vector(1):i<projected[0]!.chunks.length?vector(0,1):vector(3,4),receiptIndex:0,inputIndex:i}));
 const queries=[query,otherQuery].map((q,i)=>({querySha256:sha256Hex(q),embeddingIndex:chunks.length+i})).sort((a,b)=>a.querySha256<b.querySha256?-1:1);
 const snapshot:OhHostedSnapshotV1={protocol:"oh.semantic-hosted-snapshot.v1",profileSha256:OH_HOSTED_PROFILE_SHA256_V2,sourceSha256:hostedSourceSha256V1(records),records:projected,queries,
 embeddings:[...embeddings,...[query,otherQuery].map((q,i)=>({role:"query" as const,inputSha256:sha256Hex(q),vector:i===0?vector(0,1):vector(1),receiptIndex:1,inputIndex:i}))],receipts};
 return{records,snapshot};
}
function commit(store:OhSqliteStore,record:KnowledgeGraphRecordV1,operationId:string){store.commit({actorId:"agent.test",changes:[{kind:"put",record,v:1}],expectedHead:store.head(),operationId});}
test("distinct hosted alias profile, bounded dense vectors and raw exact query",()=>{
 expect(OH_HOSTED_EMBEDDING_PROFILE_V2).toMatchObject({dimensions:1536,modelIdentity:"alias",engine:"oh.precomputed-hosted.v1",chunkBytes:4096});
 expect(vector(3,4).slice(0,2)).toEqual([0.6,0.8]);expect(Object.isFrozen(vector(1))).toBe(true);expect(hostedQueryV1(" raw 🛶 ")).toBe(" raw 🛶 ");expect(hostedQueryV1("e\u0301\n\u0001")).toBe("e\u0301\n\u0001");
 for(const v of [[],Array(1536),Array(1536).fill(0),[1,2],Array(1536).fill(Infinity)])expect(()=>normalizeOhHostedEmbeddingV2(v)).toThrow();
 const sparse=Array(1536);sparse[0]=1;expect(()=>normalizeOhHostedEmbeddingV2(sparse)).toThrow();
 let reads=0;const getter=Array(1536).fill(0);Object.defineProperty(getter,"0",{enumerable:true,get(){reads++;return 1;}});expect(()=>normalizeOhHostedEmbeddingV2(getter)).toThrow();expect(reads).toBe(0);
 expect(()=>hostedQueryV1("x".repeat(8193))).toThrow();expect(()=>hostedQueryV1("\ud800")).toThrow();
});
test("complete UTF8 scalar chunks reconstruct the exact record document and freeze detached sources",()=>{
 const copy=structuredClone(sources[0]!),records=hostedRecordsV1([copy]),chunks=hostedDocumentChunksV1(records[0]!);
 expect(chunks.length).toBeGreaterThan(1);expect(chunks.map(c=>c.input).join("")).toBe(recordDocument(sources[0]!));
 let offset=0;for(const c of chunks){expect(c.start).toBe(offset);expect(c.end-c.start).toBe(Buffer.byteLength(c.input));expect(c.end-c.start).toBeLessThanOrEqual(4096);expect(c.inputSha256).toBe(sha256Hex(c.input));expect(/\p{Surrogate}/u.test(c.input)).toBe(false);offset=c.end;}
 expect(offset).toBe(Buffer.byteLength(recordDocument(records[0]!)));expect(Object.isFrozen(chunks)).toBe(true);expect(Object.isFrozen(chunks[0])).toBe(true);
 (copy.value as any).text="source changed";expect(recordDocument(records[0]!)).toBe(recordDocument(sources[0]!));expect(Object.isFrozen(records[0]!.value)).toBe(true);
 expect(()=>hostedDocumentChunksV1(copy)).toThrow();expect(()=>hostedRecordsV1([sources[0]!,sources[0]!])).toThrow();
});
test("snapshot parser detaches and freezes vectors, indexes only complete current source and preserves receipt identity",async()=>{
 const{records}=fixture(),snapshot=structuredClone(fixture().snapshot),parsed=parseOhHostedSnapshotV1(snapshot),backend=new OhHostedSemanticBackendV2(snapshot);
 expect(canonicalSha256(parsed)).toBe(canonicalSha256(snapshot));expect(Object.isFrozen(parsed.embeddings[0]!.vector)).toBe(true);
 (snapshot.embeddings[0]!.vector as number[])[0]=0;expect(parsed.embeddings[0]!.vector[0]).toBe(1);expect(backend.snapshot.embeddings[0]!.vector[0]).toBe(1);
 expect(()=>{(backend as any).snapshot=fixture().snapshot;}).toThrow();
 await expect(backend.index(records)).resolves.toEqual({indexed:2,v:1});await expect(backend.index(records.slice(1))).rejects.toThrow("source mismatch");
 const store=new OhSqliteStore({path:":memory:"});try{await expect(backend.search(query,2,store)).rejects.toThrow("source-validated");}finally{store.close();await backend.close();}
});
test("source, chunk, query, vector and settlement bindings reject malformed or incomplete projections",()=>{
 for(const mutate of [
 (s:any)=>s.profileSha256=sha256Hex("wrong"),(s:any)=>s.records[0].chunks[0].end--,(s:any)=>s.records[0].chunks[1].start++,
 (s:any)=>s.records[0].chunks[0].embeddingIndex=s.records[1].chunks[0].embeddingIndex,(s:any)=>s.embeddings[0].role="query",
 (s:any)=>s.embeddings[0].receiptIndex=1,(s:any)=>s.embeddings[0].inputIndex=1,(s:any)=>s.queries[0].embeddingIndex=0,
 (s:any)=>s.receipts[0].inputSha256s.pop(),(s:any)=>s.receipts[0].physicalCalls=2,(s:any)=>s.receipts[0].knownCostMicros=11,
 (s:any)=>s.receipts[0].latencyMs=Infinity,(s:any)=>s.receipts[0].requestSha256=s.receipts[1].requestSha256,(s:any)=>s.embeddings[0].vector[0]=2,
 (s:any)=>s.embeddings[0].vector=Object.assign(Array(1536),{0:1}),(s:any)=>s.records[0].extra="PRIVATE_SENTINEL",
 ]){const s=structuredClone(fixture().snapshot);mutate(s);expect(()=>parseOhHostedSnapshotV1(s)).toThrow();}
 const s=structuredClone(fixture().snapshot);let reads=0;Object.defineProperty(s,"records",{enumerable:true,get(){reads++;return[];}});expect(()=>parseOhHostedSnapshotV1(s)).toThrow();expect(reads).toBe(0);
 const cyclic:any=structuredClone(fixture().snapshot);cyclic.extra=cyclic;expect(()=>parseOhHostedSnapshotV1(cyclic)).toThrow("acyclic");
 const deep:any=structuredClone(fixture().snapshot);deep.extra=Array.from({length:40}).reduce(v=>[v],{} as any);expect(()=>parseOhHostedSnapshotV1(deep)).toThrow("structure limit");
});
test("forged document bytes and missing tail chunks fail source validation even after coherent snapshot edits",async()=>{
 const f=fixture(),s=structuredClone(f.snapshot);(s.records[0] as any).documentSha256=sha256Hex("forged document");
 const b=new OhHostedSemanticBackendV2(s);await expect(b.index(f.records)).rejects.toThrow("document/chunk");await b.close();
 const changed=[make("entity:a","changed content"),f.records[1]!],correct=new OhHostedSemanticBackendV2(f.snapshot);
 await expect(correct.index(changed)).rejects.toThrow("source mismatch");await correct.close();
 const tail:any=structuredClone(f.snapshot),removed=tail.records[0].chunks.pop().embeddingIndex;
 tail.embeddings.splice(removed,1);tail.receipts[0].inputSha256s.splice(removed,1);
 for(const e of tail.embeddings)if(e.receiptIndex===0&&e.inputIndex>removed)e.inputIndex--;
 for(const c of tail.records.flatMap((r:any)=>r.chunks))if(c.embeddingIndex>removed)c.embeddingIndex--;
 for(const q of tail.queries)if(q.embeddingIndex>removed)q.embeddingIndex--;
 const truncated=new OhHostedSemanticBackendV2(tail);await expect(truncated.index(f.records)).rejects.toThrow("document/chunk");await truncated.close();
});
test("maximum chunk cosine ranking is deterministic and rejoined to current SQLite digests",async()=>{
 const f=fixture(),b=new OhHostedSemanticBackendV2(f.snapshot),store=new OhSqliteStore({path:":memory:"});
 try{for(const[r,i]of f.records.map((r,i)=>[r,i]as const))commit(store,r,`test.hosted.${i}`);await b.index(f.records);
  const results=await b.search(query,2,store);expect(results.map(r=>r.key)).toEqual(["entity:a","entity:b"]);expect(results[0]!.score).toBe(1);expect(results[1]!.score).toBeCloseTo(0.8);
  expect((await b.search(otherQuery,1,store))[0]!.key).toBe("entity:a");
  commit(store,make("entity:a","new authority value"),"test.hosted.update");expect((await b.search(query,2,store)).map(r=>r.key)).toEqual(["entity:b"]);
  await expect(b.search(query+" ",2,store)).rejects.toThrow("exact query");await expect(b.search(query,101,store)).rejects.toThrow();
  await b.close();await b.close();await expect(b.search(query,2,store)).rejects.toThrow("closed");await expect(b.index(f.records)).rejects.toThrow("closed");
 }finally{store.close();await b.close();}
});
