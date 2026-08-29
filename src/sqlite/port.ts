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
  type OhStoreAuthorityV1,
  type OhStoreBindingV1,
  type OhStoreHostControlV1,
  type OhStoreProfileV1,
  type OhStoreV1,
  type OhStoreVerificationV1,
} from "../store";
import type { OhOperationV1 } from "../operation";
import type { OhSqliteDatabase } from "./driver";
import { OhSqliteStore } from "./store";

export type OhSqliteStoreAuthorityOptionsV1 = Readonly<{
  database?: OhSqliteDatabase;
  path?: string;
  profile?: OhStoreProfileV1;
  realmId?: string;
  spaceId?: string;
}>;

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
): OhStoreAuthorityV1 {
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
  const host: OhStoreHostControlV1 = Object.freeze({
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
  });
  return Object.freeze({ host, store });
}
