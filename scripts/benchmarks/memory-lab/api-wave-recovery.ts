/** Explicit accounting-only closure for every sibling of a stopped sole owner.
 * An occupied native or recovery lock always blocks; this module never takes over. */
import { closeSync, fsyncSync, openSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { canonicalSha256, sha256Hex } from "../../../src/canonical";
import { apiTransportCustody as custody, parseApiConfig, type ApiLedgerEvent } from "./api-transport";
import { inspectApiWaveRun, type ApiWaveReplayOptions, type ReplayedMember } from "./api-wave-replay";
import { API_WAVE_LIMITS as L, waveCheckPrefix, waveExact, waveFreeze, waveInteger, waveJsonPin, waveJsonPath,
  waveLedger, waveNeed, wavePin, waveReadPin, waveSame, waveSyncDirectory, waveWrite, type ApiWavePin } from "./api-wave-store";

type Inspection = ReturnType<typeof inspectApiWaveRun>;
function locksClear(run: Inspection): void {
  waveNeed(!custody.pathPresent(run.budget.ledgerPath + ".lock") && !custody.pathPresent(run.budget.ledgerPath + ".recovery.lock"),
    "accounting closure requires absent native and recovery locks; no takeover");
}
function boundedText(value: unknown, max: number): asserts value is string {
  waveNeed(typeof value === "string" && value.trim() === value && value.length > 0 && Buffer.byteLength(value) <= max
    && !/[\u0000-\u001f\u007f]/u.test(value) && !/\p{Surrogate}/u.test(value), "bounded canonical review text required");
}
function inventoryRow(row: ReplayedMember) {
  return { jobId: row.member.jobId, attemptId: row.member.attemptId, requestSha256: row.member.requestSha256,
    reservationMicros: row.member.reservationMicros,
    requestCapture: custody.pathPresent(row.member.requestCapture.path) ? row.member.requestCapture : null,
    requestPolicy: custody.pathPresent(row.member.requestPolicy.path) ? row.member.requestPolicy : null,
    sendPermit: row.permit, responseCapture: row.responseCapture, resultCapture: row.resultCapture,
    rejectionCapture: row.rejectionCapture, checkpoint: row.checkpoint,
    reservationOffset: row.reservationOffset, settlementOffset: row.settlementOffset, capturedMicros: row.chargedMicros };
}
/** Read-only review material. This is not authorization and does not close costs. */
export function prepareApiWaveClosureEvidence(options: ApiWaveReplayOptions) {
  const run = inspectApiWaveRun(options); locksClear(run);
  waveNeed(run.closed !== "complete", "successful run does not need stopped-owner closure");
  return waveFreeze({ protocol: "oh.memory-lab-api-wave-closure-evidence.v1", owner: run.ownerPin, plan: run.planPin,
    journal: run.journalPin, budget: run.budgetPin, ledgerPrefix: run.ledger.prefix,
    members: run.members.map(inventoryRow), plannedJobs: run.plan.jobs.length, runResumable: false });
}
export type ApiWaveBatchClosureOptions = { config: unknown; authority: ApiWavePin };
function inputs(value: unknown) {
  waveExact(value, ["config", "authority"]); const config = parseApiConfig(value.config), authorityInput = waveReadPin(value.authority, L.authorityBytes);
  const authority = waveJsonPin(authorityInput.pin, L.authorityBytes);
  waveExact(authority, ["protocol", "approved", "reviewId", "owner", "plan", "journal", "budget", "ledgerPrefix", "members", "plannedJobs", "writerExit"]);
  waveNeed(authority.protocol === "oh.memory-lab-api-wave-closure-authority.v1" && authority.approved === true, "reviewed batch authority required"); boundedText(authority.reviewId, 200);
  const owner = waveReadPin(authority.owner, L.ownerBytes), plan = waveReadPin(authority.plan, L.planBytes), journal = waveReadPin(authority.journal, L.journalBytes);
  const run = inspectApiWaveRun({ config, plan: plan.pin, journalPath: journal.pin.path });
  waveNeed(run.closed !== "complete" && waveSame(owner.pin, run.ownerPin) && waveSame(authority.budget, run.budgetPin)
    && authority.plannedJobs === run.plan.jobs.length, "stopped owner inventory required");
  waveNeed(Array.isArray(authority.members) && authority.members.length === run.members.length
    && waveSame(authority.members, run.members.map(inventoryRow)), "complete sole-owner sibling inventory changed");
  const prefix = waveCheckPrefix(run.ledger, authority.ledgerPrefix);
  waveNeed(prefix.bytes === run.executionBytes, "authority must inventory the whole pre-closure ledger");
  // No foreign unresolved reservation can be hidden by an incomplete owner list.
  const originalEvents = custody.parseLedger(run.ledger.raw.subarray(0, prefix.bytes).toString("utf8"), run.budget);
  const settledIds = new Set(originalEvents.filter(e => e.kind === "settled").map(e => e.id));
  const unresolved = originalEvents.filter(e => e.kind === "reserved" && !settledIds.has(e.id));
  waveNeed(unresolved.every(e => run.members.some(row => row.member.attemptId === e.id && row.reservationOffset !== null)), "unreviewed unresolved sibling");
  const exitInput = waveReadPin(authority.writerExit, L.writerExitBytes), exit = waveJsonPin(exitInput.pin, L.writerExitBytes);
  waveExact(exit, ["protocol", "evidenceBasis", "supervisor", "sessionId", "completionId", "exitCode", "observedExitedAt",
    "ownerId", "ownerSha256", "journalSha256", "attemptIds", "localInvocations", "runResumable"]);
  waveNeed(exit.protocol === "oh.memory-lab-api-wave-writer-exit.v1" && exit.evidenceBasis === "reviewed-supervisor-attestation"
    && exit.localInvocations === "all-exited" && exit.runResumable === false && exit.ownerId === run.owner.ownerId
    && exit.ownerSha256 === run.ownerPin.sha256 && exit.journalSha256 === run.journalPin.sha256
    && waveSame(exit.attemptIds, run.members.map(row => row.member.attemptId)), "whole-owner supervisor exit evidence required");
  boundedText(exit.supervisor, 128); boundedText(exit.completionId, 128); waveInteger(exit.sessionId); waveNeed(exit.sessionId > 0, "supervisor session required");
  waveInteger(exit.exitCode, 255); boundedText(exit.observedExitedAt, 24);
  waveNeed(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(exit.observedExitedAt)
    && Number.isFinite(Date.parse(exit.observedExitedAt)) && new Date(exit.observedExitedAt).toISOString() === exit.observedExitedAt, "canonical exit timestamp required");
  const exitAt = Date.parse(exit.observedExitedAt);
  waveNeed(exitAt >= Number(run.owner.openedAtMs) && run.members.every(row => {
    if (!row.permit) return true; const permit = waveJsonPin(row.permit, L.recordBytes);
    return permit !== null && typeof permit === "object" && "admittedAtMs" in permit && exitAt >= Number(permit.admittedAtMs);
  }), "supervisor exit predates owner or send admission");
  let nextOffset = prefix.bytes;
  const actions = run.members.map(row => {
    const action = row.reservationOffset === null ? "not-reserved" : row.settlementOffset !== null ? "already-settled"
      : row.chargedMicros !== null ? "settle-captured" : "retain-unknown";
    const micros = row.reservationOffset === null ? 0 : row.chargedMicros ?? row.member.reservationMicros;
    const event: ApiLedgerEvent | null = action === "settle-captured" || action === "retain-unknown"
      ? { v: 1, id: row.member.attemptId, kind: "settled", micros } : null;
    const offset = event ? nextOffset : row.settlementOffset; if (event) nextOffset += Buffer.byteLength(JSON.stringify(event) + "\n");
    return { jobId: row.member.jobId, attemptId: row.member.attemptId, requestSha256: row.member.requestSha256,
      action, retainedMicros: micros, settlementOffset: offset, settlement: event,
      providerOutcome: action === "retain-unknown" ? "unknown" : action === "not-reserved" ? "not-dispatched" : "captured",
      providerTerminalVerified: action === "already-settled" || action === "settle-captured",
      responseEvidence: row.chargedMicros !== null ? "validated-terminal" : row.responseCapture ? "captured-unvalidated" : "absent",
      usage: action === "retain-unknown" || action === "not-reserved" ? null : row.reply?.usage ?? null,
      acceptedResult: false, retryAuthorized: false };
  });
  const receipt = { protocol: "oh.memory-lab-api-wave-batch-accounting-closure.v1", authority: authorityInput.pin,
    ownerId: run.owner.ownerId, ownerSha256: run.ownerPin.sha256, planSha256: run.planPin.sha256,
    journalSha256: run.journalPin.sha256, budgetSha256: run.budgetPin.sha256, writerExitSha256: exitInput.pin.sha256,
    ledgerPrefixBefore: prefix, actions, plannedJobs: run.plan.jobs.length, trialStatus: "stopped", runResumable: false,
    providerCalls: 0, invoiceVerified: false, acceptedResult: false, retryAuthorized: false,
    writerExitEvidenceBasis: "reviewed-supervisor-attestation" };
  return { run, authorityPin: authorityInput.pin, writerExitPin: exitInput.pin, receipt,
    receiptPath: join(run.directory, "batch-accounting-closure.json"), prefix };
}
function accountingState(input: ReturnType<typeof inputs>) {
  // The lock excludes compliant writers; it does not make external file edits
  // impossible. Reparse leaves and missing-artifact expectations under ownership.
  const current = inspectApiWaveRun({ config: input.run.config, plan: input.run.planPin, journalPath: input.run.journalPath });
  waveNeed(waveSame(current.ownerPin, input.run.ownerPin) && waveSame(current.planPin, input.run.planPin)
    && waveSame(current.budgetPin, input.run.budgetPin) && waveSame(current.journalPin, input.run.journalPin)
    && waveSame(current.members.map(inventoryRow), input.run.members.map(inventoryRow)), "nested accounting evidence changed");
  const ledger = waveLedger(input.run.budget); waveCheckPrefix(ledger, input.prefix);
  const events = input.receipt.actions.flatMap(action => action.settlement ? [action.settlement] : []);
  const encoded = events.map(event => Buffer.from(JSON.stringify(event) + "\n")); let cursor = input.prefix.bytes, applied = 0;
  for (const bytes of encoded) {
    if (cursor === ledger.raw.length) break;
    waveNeed(ledger.raw.subarray(cursor, cursor + bytes.length).equals(bytes), "batch settlement order, amount or identity changed"); cursor += bytes.length; applied++;
  }
  // Once the entire batch is settled, later ordinary runs may append. During
  // partial replay the only growth allowed is this exact receipt's event prefix.
  if (applied < events.length) waveNeed(cursor === ledger.raw.length, "unreviewed growth during partial batch closure");
  const settledIds = new Set(ledger.events.filter(event => event.kind === "settled").map(event => event.id));
  const allowedOutstanding = new Set(events.slice(applied).map(event => event.id));
  waveNeed(ledger.events.every((event, index) => event.kind !== "reserved" || settledIds.has(event.id)
    || allowedOutstanding.has(event.id) && ledger.offsets[index]!.start < input.prefix.bytes), "unreviewed outstanding reservation outside batch inventory");
  const hasReceipt = custody.pathPresent(input.receiptPath);
  if (hasReceipt) waveNeed(waveSame(waveJsonPath(input.receiptPath, L.receiptBytes), input.receipt), "batch accounting receipt changed");
  if (applied > 0) waveNeed(hasReceipt, "batch settlement lacks prior receipt");
  waveReadPin(input.authorityPin, L.authorityBytes); waveReadPin(input.writerExitPin, L.writerExitBytes);
  return { ledger, events, applied, hasReceipt };
}
export function closeUnknownApiWaveBatch(value: unknown) {
  const input = inputs(value); locksClear(input.run);
  const lockPath = input.run.budget.ledgerPath + ".lock", fd = openSync(lockPath, "wx", 0o600);
  try {
    writeSync(fd, JSON.stringify({ protocol: "oh.memory-lab-api-wave-recovery-owner.v1", pid: process.pid,
      ownerId: input.run.owner.ownerId, authoritySha256: input.authorityPin.sha256 })); fsyncSync(fd); waveSyncDirectory(dirname(lockPath));
    waveNeed(!custody.pathPresent(input.run.budget.ledgerPath + ".recovery.lock"), "competing recovery ownership");
    const before = accountingState(input);
    if (!before.hasReceipt) waveWrite(input.receiptPath, input.receipt, L.receiptBytes);
    const checked = accountingState(input); waveNeed(checked.ledger.raw.equals(before.ledger.raw), "ledger changed while batch owner locked");
    for (let index = checked.applied; index < checked.events.length; index++) {
      const current = accountingState(input); waveNeed(current.applied === index, "batch accounting changed between appends");
      custody.appendLedger(input.run.budget.ledgerPath, checked.events[index]!);
    }
    const after = accountingState(input); waveNeed(after.applied === after.events.length, "batch accounting incomplete");
    return waveFreeze(input.receipt);
  } finally { custody.releaseOwnedLock(lockPath, fd); }
}
export function verifyUnknownApiWaveBatch(value: unknown) {
  const input = inputs(value); locksClear(input.run); const before = accountingState(input);
  waveNeed(before.hasReceipt && before.applied === before.events.length, "batch accounting incomplete");
  const after = accountingState(input); locksClear(input.run); waveNeed(before.ledger.raw.equals(after.ledger.raw), "batch changed during read-only verification");
  return waveFreeze(input.receipt);
}
