/** Offline UUID/capture replay. Reads never acquire a lock or change evidence. */
import { dirname, join } from "node:path";
import { readdirSync } from "node:fs";
import { sha256Hex } from "../../../src/canonical";
import { apiTransportCustody as custody, parseApiConfig, parseApiReply, parseApiRequestTimeoutPolicy, type ApiReply } from "./api-transport";
import { API_WAVE_LIMITS as L, parseApiWavePlan, waveBudget, waveCheckPrefix, waveExact, waveFreeze, waveHash,
  waveInteger, waveJsonPath, waveJsonPin, waveLedger, waveNeed, wavePath, wavePin, wavePrivateDirectory,
  waveReadJournal, waveReadPin, waveRequestCapturePath, waveSame, waveUuid,
  type ApiWavePin, type WaveLedgerPrefix } from "./api-wave-store";
import type { ApiWaveCheckpoint, ApiWaveMember } from "./api-wave";
import { verifyUnknownApiWaveBatch } from "./api-wave-recovery";

export type ApiWaveReplayOptions = { config: unknown; plan: ApiWavePin; journalPath: string };
export type ReplayedMember = { member: ApiWaveMember; wave: number; reservationOffset: number | null;
  settlementOffset: number | null; chargedMicros: number | null; permit: ApiWavePin | null;
  responseCapture: ApiWavePin | null; resultCapture: ApiWavePin | null; rejectionCapture: ApiWavePin | null;
  reply: ApiReply | null; checkpoint: ApiWavePin | null; checkpointValue: ApiWaveCheckpoint | null;
  journalCheckpoint: boolean; status: "not-reserved" | "not-dispatched" | "unknown" | "completed" | "failed" };
export function inspectApiWaveRun(options: ApiWaveReplayOptions) {
  const config = parseApiConfig(options.config), planInput = waveReadPin(options.plan, L.planBytes), plan = parseApiWavePlan(waveJsonPin(planInput.pin, L.planBytes), config);
  const journalPath = wavePath(options.journalPath), directory = dirname(journalPath); wavePrivateDirectory(directory);
  const ownerPath = join(directory, "owner.json"), ownerPin = wavePin(ownerPath, L.ownerBytes), owner = waveJsonPin(ownerPin, L.ownerBytes);
  waveExact(owner, ["protocol", "ownerId", "pid", "planSha256", "budgetSha256", "config", "budget", "plan", "journalPath", "openedAtMs", "initialLedgerPrefix", "noResume"]);
  waveNeed(owner.protocol === "oh.memory-lab-api-wave-owner.v1" && owner.noResume === true && owner.journalPath === journalPath
    && owner.planSha256 === planInput.pin.sha256 && waveSame(owner.plan, planInput.pin) && waveSame(owner.config, config), "owner/plan/config identity changed");
  waveUuid(owner.ownerId); waveInteger(owner.pid); waveNeed(owner.pid > 0, "owner PID required"); waveInteger(owner.openedAtMs);
  const ownerId = owner.ownerId;
  const { budget, budgetPin } = waveBudget(config); waveNeed(waveSame(budgetPin, owner.budget) && owner.budgetSha256 === budgetPin.sha256, "owner budget changed");
  const ledger = waveLedger(budget), initialPrefix = waveCheckPrefix(ledger, owner.initialLedgerPrefix);
  const closurePath = join(directory, "batch-accounting-closure.json"); let executionBytes = ledger.raw.length;
  if (custody.pathPresent(closurePath)) {
    const closure = waveJsonPath(closurePath, L.receiptBytes);
    waveNeed(closure !== null && typeof closure === "object" && "ledgerPrefixBefore" in closure, "batch receipt prefix missing");
    executionBytes = waveCheckPrefix(ledger, closure.ledgerPrefixBefore).bytes;
  }
  waveNeed(executionBytes >= initialPrefix.bytes, "closure prefix precedes owner ledger start");
  const records = waveReadJournal(journalPath), members: ReplayedMember[] = [], memberById = new Map<string, ReplayedMember>();
  const captureNames = custody.pathPresent(budget.ledgerPath + ".attempts") ? readdirSync(budget.ledgerPath + ".attempts") : [];
  waveNeed(captureNames.length <= budget.maxCalls * 16, "capture inventory bound");
  const capturesByAttempt = new Map<string, string[]>();
  for (const name of captureNames) { const id = name.slice(0, 36), names = capturesByAttempt.get(id) ?? []; names.push(name); capturesByAttempt.set(id, names); }
  const accepted = new Map<string, ApiWavePin>(); let session = -1, wavesThisSession = 0, maximumWaves = 0, deadline = 0, sessionOpened = owner.openedAtMs;
  let waveIndex = 0, active: ReplayedMember[] | null = null, stopped = false, stopRecordSeen = false, closed: "complete" | "stopped" | null = null;
  let terminalPrefix: WaveLedgerPrefix | null = null, lastPrefix = initialPrefix;
  for (const record of records) {
    waveNeed(closed === null, "records after terminal close");
    const value = record.data;
    if (record.kind === "session") {
      waveNeed(!stopped && active === null, "session requires healthy drained wave");
      waveExact(value, ["index", "openedAtMs", "deadlineMs", "maximumWaves", "ledgerPrefix", "remainingJobs", "remainingReservationMicros"]);
      waveInteger(value.openedAtMs); waveInteger(value.deadlineMs); waveInteger(value.maximumWaves, L.wavesPerSession);
      waveNeed(value.index === session + 1 && value.maximumWaves > 0 && value.openedAtMs >= sessionOpened
        && value.deadlineMs === Math.min(value.openedAtMs + L.sessionMs, Date.parse(budget.expiresAt), custody.ratesExpireAtMs)
        && value.openedAtMs + value.maximumWaves * L.timeoutMs <= value.deadlineMs, "session time or order changed");
      const remaining = plan.jobs.filter(job => !accepted.has(job.id));
      waveNeed(value.remainingJobs === remaining.length && value.maximumWaves === Math.min(5, remaining.length)
        && value.remainingReservationMicros === remaining.reduce((n, j) => n + j.maximumReservationMicros, 0), "session remaining inventory changed");
      const prefix = waveCheckPrefix(ledger, value.ledgerPrefix); waveNeed(waveSame(prefix, lastPrefix), "session continuity changed");
      const prior = custody.parseLedger(ledger.raw.subarray(0, prefix.bytes).toString("utf8"), budget);
      const reserved = prior.filter(e => e.kind === "reserved"), settled = prior.filter(e => e.kind === "settled");
      const charge = reserved.reduce((n, e) => n + e.micros, 0) - settled.reduce((n, e) => n + (reserved.find(r => r.id === e.id)!.micros - e.micros), 0);
      waveNeed(reserved.length === settled.length && reserved.length + remaining.length <= budget.maxCalls
        && charge + Number(value.remainingReservationMicros) <= Math.floor(budget.maxUsd * 1000000), "session whole-plan authority changed");
      session++; wavesThisSession = 0; maximumWaves = value.maximumWaves; deadline = value.deadlineMs; sessionOpened = value.openedAtMs;
    } else if (record.kind === "wave") {
      waveNeed(!stopped && session >= 0 && active === null && wavesThisSession < maximumWaves, "wave outside healthy session");
      waveExact(value, ["index", "session", "ledgerPrefix", "members"]);
      waveNeed(value.index === waveIndex && value.session === session && waveSame(waveCheckPrefix(ledger, value.ledgerPrefix), lastPrefix), "wave order or prefix changed");
      const ready = plan.jobs.filter(job => !memberById.has(job.id) && job.dependencies.every(id => accepted.has(id))).slice(0, plan.concurrency);
      waveNeed(Array.isArray(value.members) && value.members.length === ready.length && ready.length > 0, "canonical ready wave inventory changed");
      active = value.members.map((row: unknown, index): ReplayedMember => {
        waveExact(row, ["jobId", "attemptId", "requestSha256", "reservationMicros", "requestCapture", "requestPolicy", "dependencyReceipts"]);
        const job = ready[index]!; waveUuid(row.attemptId); waveHash(row.requestSha256); waveInteger(row.reservationMicros);
        waveNeed(row.jobId === job.id && !members.some(m => m.member.attemptId === row.attemptId)
          && row.reservationMicros > 0 && row.reservationMicros <= job.maximumReservationMicros
          && (job.requestSha256 === null || job.requestSha256 === row.requestSha256), "wave job or attempt association changed");
        waveNeed(Array.isArray(row.dependencyReceipts) && waveSame(row.dependencyReceipts, job.dependencies.map(id => accepted.get(id))), "parent checkpoint association changed");
        const requestCapture = custody.parsePin(row.requestCapture, L.requestBytes), requestPolicy = custody.parsePin(row.requestPolicy, 8192);
        waveNeed(requestCapture.path === waveRequestCapturePath(budget, row.attemptId, ".request.json")
          && requestPolicy.path === waveRequestCapturePath(budget, row.attemptId, ".request-policy.json"), "attempt capture path changed");
        const member = row as unknown as ApiWaveMember;
        const replay: ReplayedMember = { member, wave: waveIndex, reservationOffset: null, settlementOffset: null, chargedMicros: null,
          permit: null, responseCapture: null, resultCapture: null, rejectionCapture: null, reply: null,
          checkpoint: null, checkpointValue: null, journalCheckpoint: false, status: "not-reserved" };
        readMember(replay, deadline, wavesThisSession, maximumWaves);
        memberById.set(job.id, replay); members.push(replay); return replay;
      });
      // Reservations must form the canonical prefix immediately after the intent's prefix.
      let expectedOffset = lastPrefix.bytes, missing = false;
      for (const row of active) {
        if (row.reservationOffset === null) missing = true;
        else { waveNeed(!missing && row.reservationOffset === expectedOffset, "wave reservations are not a durable canonical prefix");
          const index = ledger.offsets.findIndex(o => o.start === row.reservationOffset); expectedOffset = ledger.offsets[index]!.end; }
      }
      if (active.some(row => row.permit !== null)) waveNeed(active.every(row => row.reservationOffset !== null), "dispatch before all wave reservations");
      for (const row of active) if (row.settlementOffset !== null) waveNeed(row.settlementOffset >= expectedOffset, "settlement preceded whole-wave reservation");
      waveIndex++; wavesThisSession++;
    } else if (record.kind === "checkpoint") {
      waveNeed(!stopped && active !== null, "checkpoint outside active wave"); waveExact(value, ["jobId", "attemptId", "checkpoint"]);
      const row = active.find(m => m.member.jobId === value.jobId); waveNeed(row && row.member.attemptId === value.attemptId
        && !row.journalCheckpoint && row.checkpoint && waveSame(row.checkpoint, value.checkpoint), "journal checkpoint association changed");
      row.journalCheckpoint = true; if (row.checkpointValue!.accepted) accepted.set(row.member.jobId, row.checkpoint);
    } else if (record.kind === "wave-close") {
      waveNeed(!stopped && active !== null, "wave close without active wave"); waveExact(value, ["index", "members", "ledgerPrefix"]);
      waveNeed(value.index === waveIndex - 1 && Array.isArray(value.members) && value.members.length === active.length, "wave close inventory changed");
      value.members.forEach((raw: unknown, index) => {
        waveExact(raw, ["jobId", "attemptId", "status", "checkpoint"]); const row = active![index]!;
        waveNeed(raw.jobId === row.member.jobId && raw.attemptId === row.member.attemptId, "wave close attempt changed");
        if (raw.status === "completed" || raw.status === "failed") waveNeed(row.journalCheckpoint && waveSame(raw.checkpoint, row.checkpoint)
          && raw.status === (row.checkpointValue!.accepted ? "completed" : "failed"), "completed wave member lacks exact checkpoint");
        else waveNeed((raw.status === "unknown" || raw.status === "not-dispatched") && raw.checkpoint === null, "invalid stopped member status");
      });
      const closePrefix = waveCheckPrefix(ledger, value.ledgerPrefix);
      waveNeed(closePrefix.bytes >= lastPrefix.bytes, "drained wave prefix moved backwards"); lastPrefix = closePrefix;
      waveNeed(lastPrefix.bytes <= executionBytes, "closure prefix omits a drained wave");
      const current = active; waveNeed(current.every(row => row.reservationOffset === null || row.reservationOffset < lastPrefix.bytes)
        && current.every(row => row.settlementOffset === null || row.settlementOffset < lastPrefix.bytes), "wave close omits attempt ledger event");
      // A failed wave may only be followed by stopped/closed records.
      if (value.members.some((row: unknown) => (row as { status: string }).status !== "completed")) stopped = true;
      active = null;
    } else if (record.kind === "stopped") {
      waveNeed(!stopRecordSeen, "duplicate stopped record"); stopRecordSeen = true;
      waveExact(value, ["ownerId", "plannedJobs", "completedJobs", "ledgerPrefix", "reason", "resumable"]);
      waveNeed(value.ownerId === owner.ownerId && value.plannedJobs === plan.jobs.length && value.resumable === false
        && typeof value.reason === "string" && value.reason.length <= 1000, "stopped run identity changed");
      waveInteger(value.completedJobs, plan.jobs.length); stopped = true;
      const stoppedPrefix = value.ledgerPrefix === null ? null : waveCheckPrefix(ledger, value.ledgerPrefix);
      waveNeed(stoppedPrefix === null || stoppedPrefix.bytes >= Math.max(lastPrefix.bytes, terminalPrefix?.bytes ?? 0), "stopped prefix moved backwards");
      terminalPrefix = stoppedPrefix;
      waveNeed(terminalPrefix === null || terminalPrefix.bytes <= executionBytes, "closure prefix omits stopped-owner events");
    } else {
      waveExact(value, ["ownerId", "status", "completedJobs", "plannedJobs", "ledgerPrefix", "resumable"]);
      waveNeed(value.ownerId === owner.ownerId && value.plannedJobs === plan.jobs.length && value.resumable === false
        && (value.status === "complete" || value.status === "stopped"), "closed run identity changed");
      if (value.status === "complete") waveNeed(!stopped && active === null && accepted.size === plan.jobs.length
        && value.completedJobs === plan.jobs.length, "incomplete run cannot claim success");
      else waveNeed(stopped, "stopped close lacks stop record");
      const closedPrefix = waveCheckPrefix(ledger, value.ledgerPrefix);
      waveNeed(closedPrefix.bytes >= lastPrefix.bytes && (terminalPrefix === null || waveSame(closedPrefix, terminalPrefix)), "closed prefix changed from terminal state");
      terminalPrefix = closedPrefix; closed = value.status;
      waveNeed(terminalPrefix.bytes <= executionBytes, "closure prefix omits closed-owner events");
    }
  }
  // The owned ledger interval contains only inventory UUIDs. Later campaigns may
  // append after a retained terminal prefix; they cannot be borrowed by this run.
  const bound = terminalPrefix?.bytes ?? executionBytes;
  const ownedAttempts = new Set(members.map(m => m.member.attemptId));
  waveNeed(ledger.events.every((event, index) => event.kind !== "reserved" || !ownedAttempts.has(event.id)
    || ledger.offsets[index]!.start < executionBytes), "closure prefix omits an owned reservation");
  for (const [index, event] of ledger.events.entries()) if (ledger.offsets[index]!.start >= initialPrefix.bytes && ledger.offsets[index]!.start < bound)
    waveNeed(ownedAttempts.has(event.id), "foreign event inside owned ledger interval");
  const permittedFiles = new Set(["owner.json", journalPath.slice(directory.length + 1), "batch-accounting-closure.json",
    ...members.map(m => m.member.jobId + ".checkpoint.json")]);
  waveNeed(readdirSync(directory).every(name => permittedFiles.has(name)), "unknown run artifact");
  waveReadPin(ownerPin, L.ownerBytes); waveReadPin(planInput.pin, L.planBytes); waveReadPin(budgetPin, 8192);
  return { config, plan, planPin: planInput.pin, owner, ownerPin, budget, budgetPin, ledger, records, journalPath,
    journalPin: wavePin(journalPath, L.journalBytes), directory, initialPrefix, terminalPrefix, executionBytes, members, accepted, stopped, closed };

  function readMember(row: ReplayedMember, sessionDeadline: number, usedWaves: number, sessionMaximum: number): void {
    const member = row.member, job = plan.jobs.find(j => j.id === member.jobId)!;
    const reserved = ledger.events.findIndex((e, i) => e.id === member.attemptId && e.kind === "reserved" && ledger.offsets[i]!.start < executionBytes),
      settled = ledger.events.findIndex((e, i) => e.id === member.attemptId && e.kind === "settled" && ledger.offsets[i]!.start < executionBytes);
    const hasRequest = custody.pathPresent(member.requestCapture.path), hasPolicy = custody.pathPresent(member.requestPolicy.path);
    if (hasPolicy) waveNeed(hasRequest, "policy without request capture");
    let request: ReturnType<typeof custody.capturedRequest> | null = null;
    if (hasRequest) { const raw = waveReadPin(member.requestCapture, L.requestBytes).raw; request = custody.capturedRequest(raw.toString("utf8"), config);
      waveNeed(request.requestSha256 === member.requestSha256 && request.reservationMicros === member.reservationMicros
        && Buffer.byteLength(request.raw) <= job.maximumRequestBytes && request.binding.id === job.profileId, "native request differs from wave intent"); }
    let policyAdmittedAt = sessionOpened;
    if (hasPolicy) { const policy = parseApiRequestTimeoutPolicy(waveJsonPin(member.requestPolicy, 8192)); policyAdmittedAt = policy.admittedAtMs;
      waveNeed(policy.attemptId === member.attemptId && policy.requestSha256 === member.requestSha256
        && policy.requestCaptureSha256 === member.requestCapture.sha256 && policy.budgetSha256 === budgetPin.sha256
        && policy.sessionDeadlineMs === sessionDeadline && policy.admittedAtMs >= sessionOpened
        && policy.admittedAtMs + (sessionMaximum - usedWaves) * L.timeoutMs <= sessionDeadline,
      "wave request policy changed"); }
    if (reserved >= 0) { waveNeed(request && hasPolicy && ledger.events[reserved]!.micros === member.reservationMicros
      && ledger.offsets[reserved]!.start >= initialPrefix.bytes, "reservation lacks intended native request"); row.reservationOffset = ledger.offsets[reserved]!.start; row.status = "not-dispatched"; }
    const permitPath = waveRequestCapturePath(budget, member.attemptId, ".wave-send-permit.json");
    if (custody.pathPresent(permitPath)) {
      waveNeed(reserved >= 0, "send permit without reservation"); row.permit = wavePin(permitPath); const permit = waveJsonPin(row.permit, L.recordBytes);
      waveExact(permit, ["protocol", "ownerId", "planSha256", "wave", "jobId", "attemptId", "requestSha256", "requestCaptureSha256", "requestPolicySha256", "admittedAtMs", "deadlineMs"]);
      waveInteger(permit.admittedAtMs); waveNeed(permit.protocol === "oh.memory-lab-api-wave-send-permit.v1" && permit.ownerId === ownerId
        && permit.planSha256 === planInput.pin.sha256 && permit.wave === row.wave && permit.jobId === member.jobId
        && permit.attemptId === member.attemptId && permit.requestSha256 === member.requestSha256
        && permit.requestCaptureSha256 === member.requestCapture.sha256 && permit.requestPolicySha256 === member.requestPolicy.sha256
        && permit.deadlineMs === sessionDeadline && permit.admittedAtMs >= policyAdmittedAt
        && permit.admittedAtMs + L.timeoutMs <= sessionDeadline, "send permit identity or time changed"); row.status = "unknown";
    }
    const responsePath = waveRequestCapturePath(budget, member.attemptId, ".response.json"), resultPath = waveRequestCapturePath(budget, member.attemptId, ".result.json");
    const rejectionPath = waveRequestCapturePath(budget, member.attemptId, ".rejection.json"), terminalPath = waveRequestCapturePath(budget, member.attemptId, ".terminal-rejection.json");
    if (custody.pathPresent(responsePath)) {
      waveNeed(row.permit && request, "response lacks send permit"); row.responseCapture = wavePin(responsePath, 2 * custody.responseBytes);
      const response = waveJsonPin(row.responseCapture, 2 * custody.responseBytes); waveExact(response, ["httpStatus", "body"]); waveInteger(response.httpStatus, 599);
      waveNeed(response.httpStatus >= 100 && typeof response.body === "string" && Buffer.byteLength(response.body) <= custody.responseBytes, "invalid native response capture");
      if (custody.pathPresent(resultPath)) {
        waveNeed(response.httpStatus >= 200 && response.httpStatus < 300 && !custody.pathPresent(rejectionPath) && !custody.pathPresent(terminalPath), "conflicting result captures");
        const reply = parseApiReply(JSON.parse(response.body) as unknown, request); row.resultCapture = wavePin(resultPath, 2 * custody.responseBytes);
        waveNeed(waveSame(waveJsonPin(row.resultCapture, 2 * custody.responseBytes), reply), "native result capture changed"); row.reply = reply; row.chargedMicros = reply.usage.micros;
      } else if (custody.pathPresent(rejectionPath)) {
        waveNeed([400, 401, 403, 404, 422].includes(response.httpStatus) && !custody.pathPresent(terminalPath), "unacknowledged rejection capture");
        row.rejectionCapture = wavePin(rejectionPath); waveNeed(waveSame(waveJsonPin(row.rejectionCapture, L.recordBytes), {
          httpStatus: response.httpStatus, outcome: "acknowledged-rejection", chargeBasis: "full-reservation-retained-billing-unverified", micros: member.reservationMicros }), "rejection capture changed"); row.chargedMicros = member.reservationMicros;
      } else if (custody.pathPresent(terminalPath)) {
        row.rejectionCapture = wavePin(terminalPath); const expected = custody.terminalRejection(member.attemptId, request,
          waveReadPin(member.requestCapture, L.requestBytes).raw.toString("utf8"), waveReadPin(row.responseCapture, 2 * custody.responseBytes).raw.toString("utf8"));
        waveNeed(waveSame(waveJsonPin(row.rejectionCapture, L.recordBytes), expected), "terminal rejection capture changed"); row.chargedMicros = member.reservationMicros;
      }
    } else waveNeed(!custody.pathPresent(resultPath) && !custody.pathPresent(rejectionPath) && !custody.pathPresent(terminalPath), "terminal artifact without response");
    if (settled >= 0) {
      row.settlementOffset = ledger.offsets[settled]!.start;
      waveNeed(row.chargedMicros !== null && ledger.events[settled]!.micros === row.chargedMicros, "settlement differs from native capture");
    }
    const checkpointPath = join(directory, member.jobId + ".checkpoint.json");
    if (custody.pathPresent(checkpointPath)) {
      waveNeed(row.permit && row.responseCapture && row.chargedMicros !== null && row.reservationOffset !== null && row.settlementOffset !== null, "checkpoint lacks complete native evidence");
      row.checkpoint = wavePin(checkpointPath, L.checkpointBytes); const checkpoint = waveJsonPin(row.checkpoint, L.checkpointBytes);
      const expected: ApiWaveCheckpoint = { protocol: "oh.memory-lab-api-wave-checkpoint.v1", ownerId,
        planSha256: planInput.pin.sha256, wave: row.wave, jobId: member.jobId, attemptId: member.attemptId,
        requestSha256: member.requestSha256, requestCapture: member.requestCapture, requestPolicy: member.requestPolicy,
        sendPermit: row.permit, responseCapture: row.responseCapture, resultCapture: row.resultCapture, rejectionCapture: row.rejectionCapture,
        reservationOffset: row.reservationOffset, settlementOffset: row.settlementOffset, chargedMicros: row.chargedMicros,
        accepted: row.reply?.result.status === "completed", dependencyReceipts: member.dependencyReceipts };
      waveNeed(waveSame(checkpoint, expected), "checkpoint job/attempt/capture/offset association changed"); row.checkpointValue = expected;
      row.status = expected.accepted ? "completed" : "failed";
    }
    const suffixes = new Set([".request.json", ".request-policy.json", ".wave-send-permit.json", ".response.json", ".result.json", ".rejection.json", ".terminal-rejection.json"]);
    waveNeed((capturesByAttempt.get(member.attemptId) ?? []).every(name => suffixes.has(name.slice(member.attemptId.length))), "unknown attempt artifact");
  }
}

export function verifyApiWaveRun(options: ApiWaveReplayOptions) {
  const before = inspectApiWaveRun(options), locks = [before.budget.ledgerPath + ".lock", before.budget.ledgerPath + ".recovery.lock"];
  waveNeed(!locks.some(custody.pathPresent), "offline replay requires absent native and recovery locks");
  const after = inspectApiWaveRun(options); waveNeed(waveSame(before.journalPin, after.journalPin) && before.ledger.raw.equals(after.ledger.raw)
    && waveSame(before.ownerPin, after.ownerPin) && waveSame(before.planPin, after.planPin) && waveSame(before.budgetPin, after.budgetPin)
    && waveSame(before.members, after.members)
    && !locks.some(custody.pathPresent), "run changed during offline replay");
  const receiptPath = join(before.directory, "batch-accounting-closure.json");
  if (custody.pathPresent(receiptPath)) {
    const receipt = waveJsonPath(receiptPath, L.receiptBytes); waveNeed(receipt !== null && typeof receipt === "object" && "authority" in receipt, "batch authority missing");
    verifyUnknownApiWaveBatch({ config: before.config, authority: receipt.authority });
  }
  return waveFreeze({ protocol: "oh.memory-lab-api-wave-replay.v1", ownerId: before.owner.ownerId,
    status: before.closed === "complete" ? "complete" : "stopped", plannedJobs: before.plan.jobs.length,
    completedJobs: before.accepted.size, attemptedCalls: before.members.filter(m => m.reservationOffset !== null).length,
    providerCalls: 0, invoiceVerified: false, resumable: false,
    jobs: before.plan.jobs.map(job => { const row = before.members.find(m => m.member.jobId === job.id);
      return { jobId: job.id, attemptId: row?.member.attemptId ?? null, status: row?.status ?? "not-attempted",
        checkpoint: row?.checkpoint ?? null }; }) });
}
