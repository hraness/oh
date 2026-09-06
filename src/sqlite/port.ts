import { isProxy } from "node:util/types";

import { canonicalJson } from "../canonical";
import {
  createOhStoreBindingV1,
  OH_CANONICAL_STORE_PROFILE_V1,
  OhProfileError,
  parseOhStoreProfileV1,
  type OhChangesPageV1,
  type OhCommitInputV1,
  type OhDependencyClosureV1,
  type OhHeadRefV1,
  type OhHeadV1,
  type OhSnapshotV1,
  type OhSpacePurgeReceiptV1,
  type OhStoreBindingV1,
  type OhStoreHostControlV1,
  type OhStoreProfileV1,
  type OhStoreV1,
  type OhStoreVerificationV1,
} from "../store";
import type { OhOperationV1 } from "../operation";
import {
  createOhSyncBundleV1,
  parseOhSyncBundleV1,
  parseOhSyncHeadRefV1,
  type OhSyncBundleV1,
} from "../sync-model";
import type { OhSqliteDatabase } from "./driver";
import {
  OhSqliteStore,
  type OhOperationImportResultV1,
} from "./store";

export type OhSqliteStoreAuthorityOptionsV1 = Readonly<{
  database?: OhSqliteDatabase;
  path?: string;
  profile?: OhStoreProfileV1;
  realmId?: string;
  spaceId?: string;
}>;

export interface OhSqliteCanonicalReplicationV1 {
  readonly binding: OhStoreBindingV1;
  exportBundle(input: Readonly<{
    after: OhHeadRefV1;
    limit?: number;
    through: OhHeadRefV1;
  }>): Promise<Readonly<{
    bundle: OhSyncBundleV1;
    from: OhChangesPageV1["from"];
    hasMore: boolean;
    through: OhChangesPageV1["through"];
    to: OhChangesPageV1["to"];
    v: 1;
  }>>;
  head(): Promise<OhHeadV1>;
  importBundle(input: Readonly<{
    bundle: unknown;
    expectedHead: OhHeadRefV1;
  }>): Promise<OhOperationImportResultV1>;
}

export interface OhSqliteStoreHostControlV1 extends OhStoreHostControlV1 {
  readonly replication: OhSqliteCanonicalReplicationV1 | null;
}

export type OhSqliteStoreAuthorityV1 = Readonly<{
  host: OhSqliteStoreHostControlV1;
  store: OhStoreV1;
}>;

function exactReplicationImportInputV1(value: unknown): Readonly<{
  bundle: unknown;
  expectedHead: unknown;
}> | null {
  try {
    if (typeof value !== "object" || value === null || Array.isArray(value) || isProxy(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    const keys = Reflect.ownKeys(value);
    if ((prototype !== Object.prototype && prototype !== null)
      || keys.length !== 2 || !keys.includes("bundle") || !keys.includes("expectedHead")
      || keys.some((key) => typeof key !== "string")) return null;
    const bundle = Object.getOwnPropertyDescriptor(value, "bundle");
    const expectedHead = Object.getOwnPropertyDescriptor(value, "expectedHead");
    if (bundle === undefined || expectedHead === undefined
      || !bundle.enumerable || !expectedHead.enumerable
      || bundle.get !== undefined || bundle.set !== undefined
      || expectedHead.get !== undefined || expectedHead.set !== undefined) return null;
    return { bundle: bundle.value, expectedHead: expectedHead.value };
  } catch {
    return null;
  }
}

export class OhSqliteStorePortV1 implements OhStoreV1 {
  readonly binding: OhStoreBindingV1;
  readonly #authority: OhSqliteStore;

  constructor(authority: OhSqliteStore, binding: OhStoreBindingV1) {
    const persisted = authority.bind(binding);
    if (canonicalJson(persisted) !== canonicalJson(binding)) {
      throw new OhProfileError("The SQLite authority returned a different store binding.");
    }
    this.#authority = authority;
    this.binding = persisted;
  }

  async head(): Promise<OhHeadV1> {
    return this.#authority.head();
  }

  async snapshot(options: Readonly<{
    head?: OhHeadRefV1;
    maximumRecords?: number;
  }> = {}): Promise<OhSnapshotV1> {
    return this.#authority.snapshotAtHead(options);
  }

  async changesSince(
    from: OhHeadRefV1,
    options: Readonly<{ limit?: number; through?: OhHeadRefV1 }> = {},
  ): Promise<OhChangesPageV1> {
    return this.#authority.changesSince(from, options);
  }

  async commit(input: OhCommitInputV1): Promise<OhOperationV1> {
    return this.#authority.commit(input);
  }

  async exportDependencyClosure(input: Readonly<{
    head?: OhHeadRefV1;
    maximumRecords?: number;
    roots: readonly string[];
  }>): Promise<OhDependencyClosureV1> {
    return this.#authority.exportDependencyClosure({ binding: this.binding, ...input });
  }

  async verify(): Promise<OhStoreVerificationV1> {
    const verified = this.#authority.verifyReplay();
    return { head: verified.head, integrity: "verified", operations: verified.operations,
      records: verified.records, v: 1 };
  }

  async close(): Promise<void> {
    this.#authority.close();
  }
}

/**
 * Binds a Bun SQLite authority to the promise-based store port. Retain the
 * returned `host` object in trusted control-plane code; pass only `store` to
 * ordinary consumers.
 */
export function createOhSqliteStoreAuthorityV1(
  options: OhSqliteStoreAuthorityOptionsV1 = {},
): OhSqliteStoreAuthorityV1 {
  const profile = parseOhStoreProfileV1(options.profile ?? OH_CANONICAL_STORE_PROFILE_V1);
  if (profile === null) throw new TypeError("Invalid SQLite store profile.");
  const spaceId = options.spaceId ?? "default";
  const binding = createOhStoreBindingV1({ profile,
    realmId: options.realmId ?? `realm:${spaceId}`, spaceId, v: 1 });
  const authority = new OhSqliteStore({
    ...(options.database === undefined ? {} : { database: options.database }),
    ...(options.path === undefined ? {} : { path: options.path }),
    spaceId,
  });
  const store = new OhSqliteStorePortV1(authority, binding);
  let purge: OhSpacePurgeReceiptV1 | null = null;
  const replication: OhSqliteCanonicalReplicationV1 | null =
    profile.capabilities.operationReplication
      ? Object.freeze({
          binding,
          exportBundle: async (input: Readonly<{
            after: OhHeadRefV1;
            limit?: number;
            through: OhHeadRefV1;
          }>) => {
            const page = authority.changesSince(input.after, {
              ...(input.limit === undefined ? {} : { limit: input.limit }),
              through: input.through,
            });
            const bundle = createOhSyncBundleV1(binding.spaceId, page.operations, {
              largestFittingPrefix: true,
            });
            const last = bundle.operations.at(-1);
            return Object.freeze({
              bundle,
              from: page.from,
              hasMore: page.hasMore || bundle.operations.length < page.operations.length,
              through: page.through,
              to: last === undefined ? page.from : {
                operationSha256: last.operationSha256,
                sequence: last.sequence,
              },
              v: 1 as const,
            });
          },
          head: async () => authority.head(),
          importBundle: async (input: Readonly<{
            bundle: unknown;
            expectedHead: OhHeadRefV1;
          }>) => {
            const request = exactReplicationImportInputV1(input);
            const expectedHead = request === null ? null : parseOhSyncHeadRefV1(request.expectedHead);
            if (request === null || expectedHead === null) {
              throw new TypeError("Invalid canonical replication request.");
            }
            const bundle = parseOhSyncBundleV1(request.bundle);
            if (bundle === null || bundle.spaceId !== binding.spaceId) {
              throw new TypeError("Invalid canonical replication bundle.");
            }
            return authority.importOperations({
              expectedHead,
              operations: bundle.operations,
            });
          },
        })
      : null;
  const host: OhSqliteStoreHostControlV1 = Object.freeze({
    binding,
    purgeWorkingSpace: async (input: Readonly<{ purgedAt?: string }>) => {
      if (profile.profileKind !== "working" || !profile.capabilities.wholeSpacePurge) {
        throw new OhProfileError("This host handle is not bound to a purgeable working profile.");
      }
      if (purge !== null) return purge;
      purge = authority.purgeWorkingSpace(binding, input.purgedAt);
      authority.close();
      return purge;
    },
    replication,
  });
  return Object.freeze({ host, store });
}
