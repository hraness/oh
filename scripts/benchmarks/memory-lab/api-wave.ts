/** Opt-in finite concurrent requests under one native spending-ledger owner. */
import { randomUUID } from "node:crypto";
import { closeSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { sha256Hex } from "../../../src/canonical";
import type { Message } from "../model";
import { API_MODELS, apiTransportCustody as custody, parseApiConfig, parseApiReply, requestProtocol,
  parseApiRequestTimeoutPolicy, prepareApiRequest, type ApiConfig, type ApiLedgerBudget, type ApiReply } from "./api-transport";
import { API_WAVE_LIMITS as L, parseApiWavePlan, waveAppendJournal, waveBudget, waveCheckPrefix, waveExact,
  waveFreeze, waveInteger, waveJsonPin, waveLedger, waveNeed, wavePath, wavePin, wavePrivateDirectory,
  waveReadPin, waveRequestCapturePath, waveSame, waveSyncDirectory, waveWrite,
  type ApiWaveJob, type ApiWavePin, type ApiWavePlan, type WaveJournalRecord, type WaveLedgerPrefix } from "./api-wave-store";
export { API_WAVE_LIMITS, parseApiWavePlan, type ApiWavePlan, type ApiWavePin } from "./api-wave-store";

export type ApiWaveSubmission = Readonly<{ jobId: string; messages: readonly Message[]; dependencyReceipts: readonly ApiWavePin[] }>;
export type ApiWaveBoundary = "owner" | "wave-intent" | "request-capture" | "before-reservation" | "reservation"
  | "send-permit" | "fetch-start" | "response-capture" | "result-capture" | "settlement" | "checkpoint" | "session-close";
export type ApiWaveOptions = { config: unknown; plan: ApiWavePin; journalPath: string; concurrency: number;
  requestTimeoutMs: 600000; fetcher?: typeof fetch; now?: () => number;
  /** Synchronous injected fault boundary for invented filesystem/lifecycle tests. */
  onBoundary?: (point: ApiWaveBoundary, identity: Readonly<{ ownerId: string; jobId: string | null; attemptId: string | null }>) => void };
export type ApiWaveMember = Readonly<{ jobId: string; attemptId: string; requestSha256: string; reservationMicros: number;
  requestCapture: ApiWavePin; requestPolicy: ApiWavePin; dependencyReceipts: readonly ApiWavePin[] }>;
export type ApiWaveCheckpoint = Readonly<{ protocol: "oh.memory-lab-api-wave-checkpoint.v1"; ownerId: string;
  planSha256: string; wave: number; jobId: string; attemptId: string; requestSha256: string; requestCapture: ApiWavePin;
  requestPolicy: ApiWavePin; sendPermit: ApiWavePin; responseCapture: ApiWavePin; resultCapture: ApiWavePin | null;
  rejectionCapture: ApiWavePin | null; reservationOffset: number; settlementOffset: number;
  chargedMicros: number; accepted: boolean; dependencyReceipts: readonly ApiWavePin[] }>;
export type ApiWaveResult = Readonly<{ protocol: "oh.memory-lab-api-wave-result.v1"; status: "complete" | "stopped";
  ownerId: string; wave: number; plannedJobs: number; completedJobs: number; resumable: false;
  members: readonly Readonly<{ jobId: string; attemptId: string; status: "completed" | "failed" | "unknown" | "not-dispatched";
    checkpoint: ApiWavePin | null; reply: ApiReply | null }>[] }>;
type Prepared = ReturnType<typeof prepareApiRequest>;
type PreparedMember = { member: ApiWaveMember; job: ApiWaveJob; request: Prepared; requestRaw: string; policyRaw: string };
type MemberResult = ApiWaveResult["members"][number];
const emptyFile = (path: string) => { const fd = openSync(path, "wx", 0o600); try { fsyncSync(fd); } finally { closeSync(fd); } waveSyncDirectory(dirname(path)); };
const plannedPin = (path: string, raw: string): ApiWavePin => ({ path, bytes: Buffer.byteLength(raw), sha256: sha256Hex(raw) });

export class ApiLabWaveTransport {
  readonly config: ApiConfig;
  readonly ownerId: string;
  readonly plan: ApiWavePlan;
  readonly concurrency: number;
  readonly #planPin: ApiWavePin;
  readonly #budget: ApiLedgerBudget;
  readonly #budgetPin: ApiWavePin;
  readonly #lockFd: number;
  readonly #journalPath: string;
  readonly #directory: string;
  readonly #fetcher: typeof fetch;
  readonly #now: () => number;
  readonly #onBoundary: ApiWaveOptions["onBoundary"];
  readonly #records: WaveJournalRecord[] = [];
  readonly #checkpoints = new Map<string, { pin: ApiWavePin; checkpoint: ApiWaveCheckpoint }>();
  readonly #sent = new Set<string>();
  #prefix: WaveLedgerPrefix;
  #wave = 0;
  #session = -1;
  #wavesThisSession = 0;
  #sessionWaves = 0;
  #deadline = 0;
  #busy = false;
  #closed = false;
  #halted = false;
  #stopWritten = false;
  #lastNow = 0;
  #ownerPin: ApiWavePin | null = null;
  #journalPin: ApiWavePin | null = null;
  private constructor(options: ApiWaveOptions, config: ApiConfig, plan: ApiWavePlan, budget: ApiLedgerBudget,
    budgetPin: ApiWavePin, fd: number, ownerId: string, prefix: WaveLedgerPrefix) {
    this.config = config; this.plan = plan; this.concurrency = plan.concurrency; this.ownerId = ownerId;
    this.#planPin = waveFreeze({ ...options.plan }); this.#budget = budget; this.#budgetPin = budgetPin;
    this.#lockFd = fd; this.#journalPath = options.journalPath; this.#directory = dirname(options.journalPath);
    this.#fetcher = options.fetcher ?? fetch; this.#now = options.now ?? Date.now; this.#onBoundary = options.onBoundary;
    this.#prefix = prefix;
  }
  static async open(options: ApiWaveOptions): Promise<ApiLabWaveTransport> {
    const config = parseApiConfig(options.config), planInput = waveReadPin(options.plan, L.planBytes);
    const plan = parseApiWavePlan(waveJsonPin(planInput.pin, L.planBytes), config);
    waveNeed(options.requestTimeoutMs === L.timeoutMs && options.concurrency === plan.concurrency, "plan executor policy mismatch");
    const journalPath = wavePath(options.journalPath), directory = dirname(journalPath); wavePrivateDirectory(directory);
    waveNeed(journalPath.endsWith(".jsonl"), "journal path must end in .jsonl");
    waveNeed(readdirSync(directory).length === 0, "execution requires a fresh empty run directory; no reopening or resume");
    const { budget, budgetPin } = waveBudget(config), now = options.now ?? Date.now, openedAt = now(); waveInteger(openedAt);
    waveNeed(openedAt < Math.min(Date.parse(budget.expiresAt), custody.ratesExpireAtMs), "expired budget or rates");
    waveNeed(!custody.pathPresent(budget.ledgerPath + ".recovery.lock"), "recovery ownership conflict");
    const lockFd = openSync(budget.ledgerPath + ".lock", "wx", 0o600), ownerId = randomUUID(); let transport: ApiLabWaveTransport | undefined;
    try {
      const lock = { protocol: "oh.memory-lab-api-wave-owner.v1", ownerId, pid: process.pid, planSha256: planInput.pin.sha256, budgetSha256: budgetPin.sha256 };
      writeSync(lockFd, JSON.stringify(lock)); fsyncSync(lockFd); waveSyncDirectory(dirname(budget.ledgerPath));
      waveNeed(!custody.pathPresent(budget.ledgerPath + ".recovery.lock"), "recovery ownership conflict");
      const ledger = waveLedger(budget); waveNeed(ledger.unresolved.size === 0, "unresolved provider attempts require explicit accounting closure");
      transport = new ApiLabWaveTransport(options, config, plan, budget, budgetPin, lockFd, ownerId, ledger.prefix);
      transport.#lastNow = openedAt;
      transport.#admitRemaining();
      transport.#ownerPin = waveWrite(join(directory, "owner.json"), { ...lock, config, budget: budgetPin, plan: planInput.pin,
        journalPath, openedAtMs: openedAt, initialLedgerPrefix: ledger.prefix, noResume: true }, L.ownerBytes);
      emptyFile(journalPath); transport.#journalPin = wavePin(journalPath, L.journalBytes);
      transport.#boundary("owner"); transport.#startSession(); return transport;
    } catch (error) {
      try { if (transport) transport.#stop(error); } finally { custody.releaseOwnedLock(budget.ledgerPath + ".lock", lockFd); }
      throw error;
    }
  }
  get summary() { const ledger = waveLedger(this.#budget); return waveFreeze({ ownerId: this.ownerId, plannedJobs: this.plan.jobs.length,
    completedJobs: this.#checkpoints.size, waves: this.#wave, session: this.#session, wavesThisSession: this.#wavesThisSession,
    campaignCalls: ledger.reservations, accountedMicros: ledger.exposure, halted: this.#halted, closed: this.#closed, resumable: false }); }
  #boundary(point: ApiWaveBoundary, member?: ApiWaveMember): void {
    this.#onBoundary?.(point, Object.freeze({ ownerId: this.ownerId, jobId: member?.jobId ?? null, attemptId: member?.attemptId ?? null }));
  }
  #time(): number { const now = this.#now(); waveInteger(now); waveNeed(now >= this.#lastNow, "clock moved backwards"); this.#lastNow = now; return now; }
  #record(kind: Parameters<typeof waveAppendJournal>[2], data: unknown) {
    const record = waveAppendJournal(this.#journalPath, this.#records, kind, data);
    this.#journalPin = wavePin(this.#journalPath, L.journalBytes); return record;
  }
  #authority(): void {
    waveReadPin(this.#planPin, L.planBytes); waveReadPin(this.#budgetPin, 8192);
    if (this.#ownerPin) waveReadPin(this.#ownerPin, L.ownerBytes);
    if (this.#journalPin) waveReadPin(this.#journalPin, L.journalBytes);
    const lock = lstatSync(this.#budget.ledgerPath + ".lock"), owned = fstatSync(this.#lockFd);
    waveNeed(lock.dev === owned.dev && lock.ino === owned.ino && lock.isFile() && !lock.isSymbolicLink(), "sole-owner lock identity changed");
    waveNeed(!custody.pathPresent(this.#budget.ledgerPath + ".recovery.lock"), "recovery ownership conflict");
    waveNeed(waveSame(waveLedger(this.#budget).prefix, this.#prefix), "ledger changed outside sole owner");
  }
  #admitRemaining(): void {
    this.#authority(); const ledger = waveLedger(this.#budget), remaining = this.plan.jobs.filter(job => !this.#checkpoints.has(job.id));
    const micros = remaining.reduce((total, job) => total + job.maximumReservationMicros, 0);
    waveNeed(ledger.unresolved.size === 0 && ledger.reservations + remaining.length <= this.#budget.maxCalls
      && ledger.exposure + micros <= Math.floor(this.#budget.maxUsd * 1000000), "whole remaining plan exceeds shared budget");
  }
  #startSession(): void {
    this.#admitRemaining(); const opened = this.#time();
    const remaining = this.plan.jobs.length - this.#checkpoints.size;
    waveNeed(remaining > 0, "all jobs already complete");
    this.#sessionWaves = Math.min(L.wavesPerSession, remaining);
    this.#deadline = Math.min(opened + L.sessionMs, Date.parse(this.#budget.expiresAt), custody.ratesExpireAtMs);
    waveNeed(opened + this.#sessionWaves * L.timeoutMs <= this.#deadline, "full session wave time does not fit");
    this.#session++; this.#wavesThisSession = 0;
    this.#record("session", { index: this.#session, openedAtMs: opened, deadlineMs: this.#deadline,
      maximumWaves: this.#sessionWaves, ledgerPrefix: this.#prefix, remainingJobs: remaining,
      remainingReservationMicros: this.plan.jobs.filter(j => !this.#checkpoints.has(j.id)).reduce((n, j) => n + j.maximumReservationMicros, 0) });
  }
  /** Rotation retains the same live object and lock. A new process cannot resume. */
  rotateSession(): void {
    waveNeed(!this.#closed && !this.#halted && !this.#busy && this.#wavesThisSession > 0, "only a healthy drained session may rotate");
    try { this.#boundary("session-close"); this.#startSession(); } catch (error) { this.#stop(error); throw error; }
  }
  #stop(error: unknown): void {
    this.#halted = true; if (this.#stopWritten || !custody.pathPresent(this.#journalPath)) return;
    let ledgerPrefix: WaveLedgerPrefix | null = null; try { ledgerPrefix = waveLedger(this.#budget).prefix; } catch { /* Unknown filesystem state stays unknown. */ }
    this.#record("stopped", { ownerId: this.ownerId, plannedJobs: this.plan.jobs.length,
      completedJobs: this.#checkpoints.size, ledgerPrefix, reason: String(error).slice(0, 1000), resumable: false }); this.#stopWritten = true;
  }
  #prepare(value: unknown, ready: readonly ApiWaveJob[], admittedAt: number): PreparedMember[] {
    waveNeed(Array.isArray(value) && value.length === ready.length && value.length > 0 && value.length <= this.concurrency, "complete ready wave required");
    return value.map((row: unknown, index) => {
      waveExact(row, ["jobId", "messages", "dependencyReceipts"]); const job = ready[index]!;
      waveNeed(row.jobId === job.id && Array.isArray(row.dependencyReceipts) && row.dependencyReceipts.length === job.dependencies.length, "canonical ready jobs and parents required");
      const parents = row.dependencyReceipts.map((pin, i) => {
        const saved = this.#checkpoints.get(job.dependencies[i]!); waveNeed(saved?.checkpoint.accepted && waveSame(saved.pin, pin), "verified parent checkpoint required");
        waveReadPin(saved.pin, L.checkpointBytes); this.#verifyParent(saved.checkpoint); return saved.pin;
      });
      const binding = [this.config.reader, this.config.judge].find(b => b.id === job.profileId)!;
      const request = prepareApiRequest(binding, row.messages as readonly Message[]);
      waveNeed((job.requestSha256 === null || job.requestSha256 === request.requestSha256)
        && request.reservationMicros <= job.maximumReservationMicros && Buffer.byteLength(request.raw) <= job.maximumRequestBytes,
      "prepared request exceeds frozen job envelope");
      const attemptId = randomUUID(), requestRaw = JSON.stringify({ protocol: requestProtocol(request.binding), binding: request.binding,
        requestSha256: request.requestSha256, endpoint: request.endpoint, body: JSON.parse(request.raw), reservationMicros: request.reservationMicros });
      const requestCapture = plannedPin(waveRequestCapturePath(this.#budget, attemptId, ".request.json"), requestRaw);
      const policyRaw = JSON.stringify(parseApiRequestTimeoutPolicy({ protocol: "oh.memory-lab-api-request-policy.v1", attemptId,
        requestSha256: request.requestSha256, requestCaptureSha256: requestCapture.sha256, timeoutMs: L.timeoutMs,
        admittedAtMs: admittedAt, sessionDeadlineMs: this.#deadline, budgetSha256: this.#budgetPin.sha256 }));
      const member = waveFreeze({ jobId: job.id, attemptId, requestSha256: request.requestSha256, reservationMicros: request.reservationMicros,
        requestCapture, requestPolicy: plannedPin(waveRequestCapturePath(this.#budget, attemptId, ".request-policy.json"), policyRaw), dependencyReceipts: parents });
      return { member, job, request, requestRaw, policyRaw };
    });
  }
  #verifyParent(parent: ApiWaveCheckpoint): void {
    waveReadPin(parent.requestCapture, L.requestBytes); waveReadPin(parent.requestPolicy, 8192);
    waveReadPin(parent.sendPermit, L.recordBytes); waveReadPin(parent.responseCapture, 2 * custody.responseBytes);
    waveNeed(parent.accepted && parent.resultCapture !== null && parent.rejectionCapture === null, "completed parent result required");
    waveReadPin(parent.resultCapture, 2 * custody.responseBytes);
  }
  async invokeWave(submissions: readonly ApiWaveSubmission[]): Promise<ApiWaveResult> {
    waveNeed(!this.#closed && !this.#halted && !this.#busy, "closed, halted or concurrent wave owner"); this.#busy = true;
    let prepared: PreparedMember[] = [], results: MemberResult[] = [], waveIndex = this.#wave;
    try {
      this.#admitRemaining(); waveNeed(this.#wavesThisSession < this.#sessionWaves, "rotate the drained session before another wave");
      const now = this.#time();
      waveNeed(now + (this.#sessionWaves - this.#wavesThisSession) * L.timeoutMs <= this.#deadline, "remaining session waves do not fit");
      const ready = this.plan.jobs.filter(job => !this.#checkpoints.has(job.id) && job.dependencies.every(id => this.#checkpoints.get(id)?.checkpoint.accepted)).slice(0, this.concurrency);
      prepared = this.#prepare(submissions, ready, now);
      this.#record("wave", { index: waveIndex, session: this.#session, ledgerPrefix: this.#prefix, members: prepared.map(p => p.member) });
      this.#wave++; this.#wavesThisSession++; this.#boundary("wave-intent");
      mkdirSync(this.#budget.ledgerPath + ".attempts", { recursive: true, mode: 0o700 });
      wavePrivateDirectory(this.#budget.ledgerPath + ".attempts");
      for (const item of prepared) {
        custody.writeCapture(item.member.requestCapture.path, item.requestRaw); custody.writeCapture(item.member.requestPolicy.path, item.policyRaw);
        this.#boundary("request-capture", item.member); waveReadPin(item.member.requestCapture, L.requestBytes); waveReadPin(item.member.requestPolicy, 8192);
        this.#authority(); this.#boundary("before-reservation", item.member); this.#authority();
        custody.appendLedger(this.#budget.ledgerPath, { v: 1, id: item.member.attemptId, kind: "reserved", micros: item.request.reservationMicros });
        this.#prefix = waveLedger(this.#budget).prefix; this.#boundary("reservation", item.member);
      }
      // No asynchronous task starts before the whole wave has durable reservations.
      const tasks = prepared.map(item => this.#dispatch(item, waveIndex)); results = await Promise.all(tasks);
      this.#record("wave-close", { index: waveIndex, members: results.map(({ reply: _reply, ...row }) => row), ledgerPrefix: this.#prefix });
      if (results.some(row => row.status !== "completed")) this.#stop("wave member failed; all dispatched siblings drained");
    } catch (error) {
      this.#stop(error); throw error;
    } finally { this.#busy = false; }
    return waveFreeze({ protocol: "oh.memory-lab-api-wave-result.v1", status: this.#halted ? "stopped" : "complete",
      ownerId: this.ownerId, wave: waveIndex, plannedJobs: this.plan.jobs.length, completedJobs: this.#checkpoints.size,
      resumable: false, members: results });
  }
  async #dispatch(item: PreparedMember, waveIndex: number): Promise<MemberResult> {
    const { member, request } = item; let permit: ApiWavePin | null = null, reply: ApiReply | null = null;
    try {
      if (this.#halted) return { jobId: member.jobId, attemptId: member.attemptId, status: "not-dispatched", checkpoint: null, reply: null };
      this.#authority(); waveNeed(this.#time() + L.timeoutMs <= this.#deadline, "full request timeout expired before send");
      waveReadPin(member.requestCapture, L.requestBytes); waveReadPin(member.requestPolicy, 8192);
      for (const [index, parent] of member.dependencyReceipts.entries()) {
        waveReadPin(parent, L.checkpointBytes); this.#verifyParent(this.#checkpoints.get(item.job.dependencies[index]!)!.checkpoint);
      }
      const key = process.env[request.binding.keyEnv]; waveNeed(key, "selected credential is absent");
      waveNeed(!this.#sent.has(member.attemptId), "local send already consumed");
      permit = waveWrite(waveRequestCapturePath(this.#budget, member.attemptId, ".wave-send-permit.json"), {
        protocol: "oh.memory-lab-api-wave-send-permit.v1", ownerId: this.ownerId, planSha256: this.#planPin.sha256,
        wave: waveIndex, jobId: member.jobId, attemptId: member.attemptId, requestSha256: member.requestSha256,
        requestCaptureSha256: member.requestCapture.sha256, requestPolicySha256: member.requestPolicy.sha256,
        admittedAtMs: this.#time(), deadlineMs: this.#deadline });
      this.#sent.add(member.attemptId); this.#boundary("send-permit", member);
      this.#authority(); waveNeed(this.#time() + L.timeoutMs <= this.#deadline, "full request timeout expired after send permit");
      this.#boundary("fetch-start", member);
      this.#authority(); waveNeed(this.#time() + L.timeoutMs <= this.#deadline, "full request timeout expired at dispatch");
      const response = await this.#fetcher(request.endpoint, { method: "POST", redirect: "error", body: request.raw,
        headers: { "Content-Type": "application/json", ...(API_MODELS[request.binding.model].provider === "gemini" ? { "x-goog-api-key": key } : { Authorization: `Bearer ${key}` }) }, signal: AbortSignal.timeout(L.timeoutMs) });
      const reader = response.body?.getReader(); waveNeed(reader, "missing response body; reservation retained");
      const chunks: Uint8Array[] = []; let bytes = 0;
      try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.length;
        if (bytes > custody.responseBytes) { await reader.cancel(); throw Error("response bound exceeded; reservation retained"); } chunks.push(chunk.value); }
      } finally { reader.releaseLock(); }
      const body = Buffer.concat(chunks).toString("utf8"), responseRaw = JSON.stringify({ httpStatus: response.status, body });
      const responsePath = waveRequestCapturePath(this.#budget, member.attemptId, ".response.json");
      custody.writeCapture(responsePath, responseRaw); this.#boundary("response-capture", member);
      waveReadPin(plannedPin(responsePath, responseRaw), 2 * custody.responseBytes);
      let resultCapture: ApiWavePin | null = null, rejectionCapture: ApiWavePin | null = null, chargedMicros = request.reservationMicros;
      if (!response.ok) {
        waveNeed([400, 401, 403, 404, 422].includes(response.status), `HTTP ${response.status}; reservation retained`);
        const path = waveRequestCapturePath(this.#budget, member.attemptId, ".rejection.json");
        custody.writeCapture(path, JSON.stringify({ httpStatus: response.status, outcome: "acknowledged-rejection",
          chargeBasis: "full-reservation-retained-billing-unverified", micros: request.reservationMicros })); rejectionCapture = wavePin(path);
      } else {
        try { reply = parseApiReply(JSON.parse(body) as unknown, request); }
        catch (error) {
          let rejection; try { rejection = custody.terminalRejection(member.attemptId, request, item.requestRaw, responseRaw); } catch { throw error; }
          const path = waveRequestCapturePath(this.#budget, member.attemptId, ".terminal-rejection.json");
          custody.writeCapture(path, JSON.stringify(rejection)); rejectionCapture = wavePin(path);
        }
        if (reply) { const path = waveRequestCapturePath(this.#budget, member.attemptId, ".result.json"), raw = JSON.stringify(reply); custody.writeCapture(path, raw);
          resultCapture = plannedPin(path, raw); chargedMicros = reply.usage.micros; this.#boundary("result-capture", member);
          waveReadPin(resultCapture, 2 * custody.responseBytes); }
      }
      this.#authority(); const ledger = waveLedger(this.#budget), reservationIndex = ledger.events.findIndex(e => e.id === member.attemptId && e.kind === "reserved");
      waveNeed(reservationIndex >= 0 && ledger.unresolved.has(member.attemptId), "unique unsettled reservation required");
      const settlementOffset = ledger.raw.length;
      custody.appendLedger(this.#budget.ledgerPath, { v: 1, id: member.attemptId, kind: "settled", micros: chargedMicros });
      this.#prefix = waveLedger(this.#budget).prefix; this.#boundary("settlement", member);
      const checkpoint: ApiWaveCheckpoint = { protocol: "oh.memory-lab-api-wave-checkpoint.v1", ownerId: this.ownerId,
        planSha256: this.#planPin.sha256, wave: waveIndex, jobId: member.jobId, attemptId: member.attemptId,
        requestSha256: member.requestSha256, requestCapture: member.requestCapture, requestPolicy: member.requestPolicy,
        dependencyReceipts: member.dependencyReceipts, sendPermit: permit,
        responseCapture: wavePin(responsePath, 2 * custody.responseBytes), resultCapture, rejectionCapture,
        reservationOffset: ledger.offsets[reservationIndex]!.start, settlementOffset, chargedMicros, accepted: reply?.result.status === "completed" };
      const saved = checkpoint;
      const pin = waveWrite(join(this.#directory, member.jobId + ".checkpoint.json"), saved, L.checkpointBytes);
      this.#record("checkpoint", { jobId: member.jobId, attemptId: member.attemptId, checkpoint: pin }); this.#boundary("checkpoint", member);
      if (saved.accepted) this.#checkpoints.set(member.jobId, { pin, checkpoint: saved }); else this.#halted = true;
      return { jobId: member.jobId, attemptId: member.attemptId, status: saved.accepted ? "completed" : "failed", checkpoint: pin, reply };
    } catch {
      this.#halted = true;
      return { jobId: member.jobId, attemptId: member.attemptId, status: permit ? "unknown" : "not-dispatched", checkpoint: null, reply: null };
    }
  }
  close(): void {
    if (this.#closed) return; waveNeed(!this.#busy, "cannot close before all wave siblings drain");
    try {
      this.#authority(); if (this.#halted || this.#checkpoints.size !== this.plan.jobs.length) this.#stop("closed before every declared job completed");
      this.#boundary("session-close");
      this.#record("closed", { ownerId: this.ownerId, status: this.#halted ? "stopped" : "complete",
        completedJobs: this.#checkpoints.size, plannedJobs: this.plan.jobs.length, ledgerPrefix: this.#prefix, resumable: false });
    } finally { this.#closed = true; custody.releaseOwnedLock(this.#budget.ledgerPath + ".lock", this.#lockFd); }
  }
}
