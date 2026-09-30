#!/usr/bin/env bun
import type { CliUpdateOptions, StartupResult } from "@hraness/cli-update";
type EntryPorts = {
    update(options: CliUpdateOptions): Promise<StartupResult>;
    main(): Promise<void>;
};
export declare function runOhEntrypoint(argv?: string[], ports?: Partial<EntryPorts>): Promise<void>;
export {};
//# sourceMappingURL=cli-entry.d.ts.map