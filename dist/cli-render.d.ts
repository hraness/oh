import type { KnowledgeGraphRecordV1 } from "./graph";
import type { OhOperationV1 } from "./operation";
import type { OhSearchResponseV1 } from "./search";
import { type Env, type Stream } from "./cli-style";
type Head = Readonly<{
    generation: number;
}>;
type Output = Readonly<{
    stream: Stream;
    env: Env;
}>;
export declare function renderInit(databasePath: string, spaceId: string, head: Head, output: Output): string;
export declare function renderPut(key: string, head: Head, output: Output): string;
export declare function renderTombstone(key: string, head: Head, output: Output): string;
export declare function renderRecord(record: KnowledgeGraphRecordV1): string;
export declare function renderList(records: readonly KnowledgeGraphRecordV1[], spaceId: string): string;
export declare function renderLog(operations: readonly OhOperationV1[], spaceId: string): string;
export declare function renderSearch(query: string, response: OhSearchResponseV1): string;
export declare function renderVerify(result: Readonly<{
    head: Head;
    operations: number;
    records: number;
}>, output: Output): string;
export declare function renderImport(imported: number, head: Head, output: Output): string;
export {};
//# sourceMappingURL=cli-render.d.ts.map