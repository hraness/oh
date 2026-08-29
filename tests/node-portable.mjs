import assert from "node:assert/strict";

// Exercise the published package subpaths, not internal build paths. This also
// catches an export that accidentally makes Bun-only modules reachable.
const store = await import("@hraness/oh/store");
const libsql = await import("@hraness/oh/libsql");

assert.equal(typeof store.createOhStoreBindingV1, "function");
assert.equal(typeof store.OhSemanticBundleIngressV1, "function");
assert.equal(typeof libsql.createOhLibSqlStoreAuthorityV1, "function");
assert.equal(store.OH_WORKING_STORE_PROFILE_V1.profileKind, "working");
assert.equal(store.OH_WORKING_STORE_PROFILE_V1.capabilities.operationReplication, false);
assert.equal(store.OH_WORKING_STORE_PROFILE_V1.capabilities.wholeSpacePurge, true);
