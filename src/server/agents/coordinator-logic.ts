import { nanoid } from "nanoid";
import type { ErrorClass } from "../llm/classify";
import { CIRCUIT_OPEN_MS, CIRCUIT_THRESHOLD } from "../llm/classify";

export type Dimension =
  | "requests"
  | "inputTokens"
  | "outputTokens"
  | "totalTokens"
  | "neurons"
  | "audioSeconds"
  | "concurrentRequests"
  | "rowWrites"
  | "GBSeconds";

export type WindowKind = "minute" | "hour" | "day" | "concurrency";

export interface QuotaKey {
  provider: string;
  org: string;
  project: string;
  quotaGroup: string;
}

export interface WindowId {
  kind: WindowKind;
  start: number;
  end: number;
  providerResetId?: string;
}

export interface ReservationEntry {
  quotaKey: QuotaKey;
  window: WindowId;
  dimension: Dimension;
  amount: number;
}

export interface Usage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  neurons?: number;
  audioSeconds?: number;
  requests?: number;
}

export interface ReserveRequest {
  requestId: string;
  sessionId: string;
  turnId: string;
  attempt: number;
  configVersion: string;
  idempotencyKey: string;
  entries: ReservationEntry[];
  estimate: {
    inputTokens: number;
    maxOutputTokens: number;
    asrSeconds?: number;
  };
}

export interface Reservation {
  leaseId: string;
  request: ReserveRequest;
  entries: ReservationEntry[];
  estimate: ReserveRequest["estimate"];
  dispatchedAt?: number;
  actualUsage?: Usage;
  status: "reserved" | "dispatched" | "reconciled" | "unknown";
}

export type ReserveOutcome =
  | { ok: true; lease: Reservation }
  | {
      ok: false;
      reason: "quota_exhausted" | "coordinator_unavailable" | "model_disabled";
      deniedEntry?: ReservationEntry;
    };

export type DispatchOutcome =
  | { ok: true; lease: Reservation }
  | { ok: false; reason: "not_found" | "already_dispatched" };

export type ReconcileOutcome =
  | { ok: true; lease: Reservation }
  | { ok: false; reason: "not_found" | "not_dispatched" };

export interface SessionEnvelope {
  remaining: {
    lightCalls: number;
    heavyCalls: number;
    vlmFrames: number;
    cloudAsrClips: number;
    cloudAsrSeconds: number;
    totalTokens: number;
    wallSeconds: number;
  };
}

export const HARD_LIMITS = {
  wallSeconds: 600,
  wallWarningSeconds: 480,
  cloudAsrClips: 12,
  cloudAsrSeconds: 180,
  lightCalls: 4,
  heavyCalls: 2,
  vlmFrames: 6
} as const;

export interface AdmissionRequest {
  voiceCapable: boolean;
  needsCloudVoice: boolean;
  envelopeDemand: SessionEnvelope["remaining"];
}

export type AdmissionResult =
  | {
      ok: true;
      sessionId: string;
      envelope: SessionEnvelope;
      voiceAdmitted: boolean;
    }
  | {
      ok: false;
      reason: "capacity" | "voice_unavailable" | "per_ip" | "queue_full";
    }
  | {
      ok: false;
      reason: "queued";
      ticket: string;
      position: number;
      retryAfterSec: number;
    };

export type ConsumeResult =
  | { ok: true; remaining: SessionEnvelope["remaining"] }
  | { ok: false; reason: "envelope_exhausted"; message: string };

interface WindowCounter {
  quotaKeyStr: string;
  windowKind: WindowKind;
  windowStart: number;
  windowEnd: number;
  providerResetId?: string;
  dimension: Dimension;
  reserved: number;
  spent: number;
}

export interface ReservationLedger {
  windows: Map<string, WindowCounter>;
  leases: Map<string, Reservation>;
  idempotencyKeys: Map<string, string>;
}

export function createReservationLedger(): ReservationLedger {
  return {
    windows: new Map(),
    leases: new Map(),
    idempotencyKeys: new Map()
  };
}

function windowCounterKey(
  quotaKeyStr: string,
  windowKind: WindowKind,
  windowStart: number,
  dimension: Dimension
): string {
  return `${quotaKeyStr}:${windowKind}:${windowStart}:${dimension}`;
}

function quotaKeyToString(k: QuotaKey): string {
  return `${k.provider}:${k.org}:${k.project}:${k.quotaGroup}`;
}

function getProviderResetId(provider: string): string {
  if (provider === "workers-ai") return "cf-00UTC";
  if (provider === "gemini") return "gemini-midnightPacific";
  if (provider === "groq") return "groq-header";
  return `${provider}-00UTC`;
}

function getUtcMidnight(now: number): number {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function getPacificMidnight(now: number): number {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  const utcMidnight = d.getTime();
  return utcMidnight - 8 * 60 * 60 * 1000;
}

export function computeWindow(
  provider: string,
  kind: WindowKind,
  now: number
): WindowId {
  if (kind === "concurrency") {
    return { kind, start: 0, end: Infinity, providerResetId: getProviderResetId(provider) };
  }
  if (kind === "minute") {
    const start = Math.floor(now / 60_000) * 60_000;
    return { kind, start, end: start + 60_000, providerResetId: getProviderResetId(provider) };
  }
  if (kind === "hour") {
    const start = Math.floor(now / 3_600_000) * 3_600_000;
    return { kind, start, end: start + 3_600_000, providerResetId: getProviderResetId(provider) };
  }
  const resetId = getProviderResetId(provider);
  if (provider === "gemini") {
    const start = getPacificMidnight(now);
    return { kind: "day", start, end: start + 86_400_000, providerResetId: resetId };
  }
  const start = getUtcMidnight(now);
  return { kind: "day", start, end: start + 86_400_000, providerResetId: resetId };
}

function getActualAmount(dimension: Dimension, usage: Usage): number {
  switch (dimension) {
    case "requests":
      return usage.requests ?? 1;
    case "inputTokens":
      return usage.inputTokens ?? 0;
    case "outputTokens":
      return usage.outputTokens ?? 0;
    case "totalTokens":
      return usage.totalTokens ?? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
    case "neurons":
      return usage.neurons ?? 0;
    case "audioSeconds":
      return usage.audioSeconds ?? 0;
    default:
      return 0;
  }
}

type SessionState = "active" | "queued" | "idle" | "released";

interface SessionEntry {
  sessionId: string;
  ipHash: string;
  state: SessionState;
  lastHeartbeat: number;
  createdAt: number;
  envelope?: SessionEnvelope;
  voiceAdmitted?: boolean;
}

interface QueueEntry {
  ticket: string;
  sessionId: string;
  ipHash: string;
  position: number;
  createdAt: number;
}

interface IpCount {
  hour: number;
  day: number;
  hourStart: number;
  dayStart: number;
}

export interface ModelQuota {
  cooldownUntil: number;
  consecutiveFailures: number;
  disabled: boolean;
  requestsThisMinute: number;
  requestsToday: number;
  tokensInToday: number;
  tokensOutToday: number;
  minuteStart: number;
  dayStart: number;
  lastRateLimitHeaders: Record<string, string | undefined>;
}

export interface KillSwitches {
  disabledProviders: string[];
  disabledModels: string[];
  forceDegraded: boolean;
  admissionsPaused: boolean;
}

export interface CoordinatorData {
  sessions: Record<string, SessionEntry>;
  queue: QueueEntry[];
  ipCounts: Record<string, IpCount>;
  quotas: Record<string, ModelQuota>;
  killSwitches: KillSwitches;
  ledger: ReservationLedger;
}

export type AdmitResult =
  | { status: "admitted"; sessionId: string }
  | {
      status: "queued";
      sessionId: string;
      ticket: string;
      position: number;
      retryAfterSec: number;
    }
  | { status: "rejected"; reason: string };

export type QueueCheckResult =
  | { status: "admitted"; sessionId: string }
  | { status: "queued"; position: number; retryAfterSec: number }
  | { status: "expired" };

const DEFAULT_MAX_ACTIVE = 20;
const DEFAULT_QUEUE_CAP = 50;
const DEFAULT_PER_IP_HOURLY = 3;
const DEFAULT_PER_IP_DAILY = 10;
const HEARTBEAT_TIMEOUT_MS = 10 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function createCoordinatorData(): CoordinatorData {
  return {
    sessions: {},
    queue: [],
    ipCounts: {},
    quotas: {},
    killSwitches: {
      disabledProviders: [],
      disabledModels: [],
      forceDegraded: false,
      admissionsPaused: false
    },
    ledger: createReservationLedger()
  };
}

function createModelQuota(now: number): ModelQuota {
  return {
    cooldownUntil: 0,
    consecutiveFailures: 0,
    disabled: false,
    requestsThisMinute: 0,
    requestsToday: 0,
    tokensInToday: 0,
    tokensOutToday: 0,
    minuteStart: now,
    dayStart: now,
    lastRateLimitHeaders: {}
  };
}

export class CoordinatorLogic {
  data: CoordinatorData;
  maxActive: number;
  queueCap: number;
  perIpHourly: number;
  perIpDaily: number;

  constructor(
    data: CoordinatorData,
    opts?: {
      maxActive?: number;
      queueCap?: number;
      perIpHourly?: number;
      perIpDaily?: number;
    }
  ) {
    this.data = data;
    this.maxActive = opts?.maxActive ?? DEFAULT_MAX_ACTIVE;
    this.queueCap = opts?.queueCap ?? DEFAULT_QUEUE_CAP;
    this.perIpHourly = opts?.perIpHourly ?? DEFAULT_PER_IP_HOURLY;
    this.perIpDaily = opts?.perIpDaily ?? DEFAULT_PER_IP_DAILY;
  }

  admit(
    { ipHash }: { ipHash: string },
    sessionId?: string,
    now: number = Date.now()
  ): AdmitResult {
    this.updateIpCounts(ipHash, now);
    const ipData = this.data.ipCounts[ipHash];
    if (ipData.hour > this.perIpHourly || ipData.day > this.perIpDaily) {
      return { status: "rejected", reason: "per_ip_limit" };
    }

    const sid = sessionId ?? nanoid(21);
    const activeCount = Object.values(this.data.sessions).filter(
      (s) => s.state === "active"
    ).length;

    if (activeCount < this.maxActive) {
      this.data.sessions[sid] = {
        sessionId: sid,
        ipHash,
        state: "active",
        lastHeartbeat: now,
        createdAt: now
      };
      return { status: "admitted", sessionId: sid };
    }

    if (this.data.queue.length >= this.queueCap) {
      return { status: "rejected", reason: "queue_full" };
    }

    const ticket = nanoid(12);
    this.data.queue.push({
      ticket,
      sessionId: sid,
      ipHash,
      position: this.data.queue.length + 1,
      createdAt: now
    });
    return {
      status: "queued",
      sessionId: sid,
      ticket,
      position: this.data.queue.length,
      retryAfterSec: 20
    };
  }

  admitWithEnvelope(
    req: AdmissionRequest,
    ipHash: string,
    sessionId?: string,
    now: number = Date.now()
  ): AdmissionResult {
    this.updateIpCounts(ipHash, now);
    const ipData = this.data.ipCounts[ipHash];
    if (ipData.hour > this.perIpHourly || ipData.day > this.perIpDaily) {
      return { ok: false, reason: "per_ip" };
    }

    if (req.needsCloudVoice && !req.voiceCapable) {
      return { ok: false, reason: "voice_unavailable" };
    }

    const sid = sessionId ?? nanoid(21);
    const activeCount = Object.values(this.data.sessions).filter(
      (s) => s.state === "active"
    ).length;

    const normalCeiling = Math.floor(this.maxActive * 0.7);
    if (activeCount >= normalCeiling) {
      if (this.data.queue.length >= this.queueCap) {
        return { ok: false, reason: "queue_full" };
      }
      const ticket = nanoid(12);
      this.data.queue.push({
        ticket,
        sessionId: sid,
        ipHash,
        position: this.data.queue.length + 1,
        createdAt: now
      });
      return {
        ok: false,
        reason: "queued",
        ticket,
        position: this.data.queue.length,
        retryAfterSec: 20
      };
    }

    const envelope: SessionEnvelope = {
      remaining: { ...req.envelopeDemand }
    };

    this.data.sessions[sid] = {
      sessionId: sid,
      ipHash,
      state: "active",
      lastHeartbeat: now,
      createdAt: now,
      envelope,
      voiceAdmitted: req.voiceCapable
    };

    return {
      ok: true,
      sessionId: sid,
      envelope,
      voiceAdmitted: req.voiceCapable
    };
  }

  consumeEnvelope(
    sessionId: string,
    consumption: Partial<SessionEnvelope["remaining"]>,
    now: number = Date.now()
  ): ConsumeResult {
    const entry = this.data.sessions[sessionId];
    if (!entry || !entry.envelope) {
      return {
        ok: false,
        reason: "envelope_exhausted",
        message: "Session not found"
      };
    }

    const remaining = entry.envelope.remaining;
    const wallElapsed = Math.floor((now - entry.createdAt) / 1000);
    const effectiveWall = Math.min(
      remaining.wallSeconds,
      HARD_LIMITS.wallSeconds - wallElapsed
    );

    for (const [key, amount] of Object.entries(consumption)) {
      if (amount === undefined) continue;
      const k = key as keyof SessionEnvelope["remaining"];
      if (k === "wallSeconds") continue;
      if (remaining[k] < amount) {
        return {
          ok: false,
          reason: "envelope_exhausted",
          message: "Further analysis paused — session envelope exhausted."
        };
      }
    }

    if (effectiveWall <= 0) {
      return {
        ok: false,
        reason: "envelope_exhausted",
        message: "Further analysis paused — session time limit reached."
      };
    }

    for (const [key, amount] of Object.entries(consumption)) {
      if (amount === undefined) continue;
      const k = key as keyof SessionEnvelope["remaining"];
      if (k !== "wallSeconds") {
        remaining[k] -= amount;
      }
    }

    return { ok: true, remaining };
  }

  getEnvelope(sessionId: string): SessionEnvelope | undefined {
    return this.data.sessions[sessionId]?.envelope;
  }

  isVoiceAdmitted(sessionId: string): boolean {
    return this.data.sessions[sessionId]?.voiceAdmitted ?? false;
  }

  heartbeat(sessionId: string, now: number = Date.now()): void {
    const entry = this.data.sessions[sessionId];
    if (entry) entry.lastHeartbeat = now;
  }

  release(sessionId: string): void {
    delete this.data.sessions[sessionId];
  }

  checkQueue(ticket: string, now: number = Date.now()): QueueCheckResult {
    const idx = this.data.queue.findIndex((q) => q.ticket === ticket);
    if (idx < 0) return { status: "expired" };

    const activeCount = Object.values(this.data.sessions).filter(
      (s) => s.state === "active"
    ).length;

    if (idx === 0 && activeCount < this.maxActive) {
      const entry = this.data.queue.shift()!;
      this.data.sessions[entry.sessionId] = {
        sessionId: entry.sessionId,
        ipHash: entry.ipHash,
        state: "active",
        lastHeartbeat: now,
        createdAt: now
      };
      this.promoteFromQueue();
      return { status: "admitted", sessionId: entry.sessionId };
    }

    return { status: "queued", position: idx + 1, retryAfterSec: 20 };
  }

  sweepIdle(now: number = Date.now()): void {
    for (const [id, entry] of Object.entries(this.data.sessions)) {
      if (
        entry.state === "active" &&
        now - entry.lastHeartbeat > HEARTBEAT_TIMEOUT_MS
      ) {
        delete this.data.sessions[id];
      }
    }
  }

  activeCount(): number {
    return Object.values(this.data.sessions).filter((s) => s.state === "active")
      .length;
  }

  queuedCount(): number {
    return this.data.queue.length;
  }

  isCooling(key: string, now: number = Date.now()): boolean {
    const provider = key.split(":")[0];
    if (this.data.killSwitches.disabledProviders.includes(provider))
      return true;
    if (this.data.killSwitches.disabledModels.includes(key)) return true;
    const q = this.data.quotas[key];
    if (!q) return false;
    if (q.disabled) return true;
    if (q.cooldownUntil > now) return true;
    return false;
  }

  report(
    key: string,
    result: { ok: true } | { ok: false; errorClass: ErrorClass },
    now: number = Date.now()
  ): void {
    if (!this.data.quotas[key]) {
      this.data.quotas[key] = createModelQuota(now);
    }
    const q = this.data.quotas[key];

    if (now - q.minuteStart > 60_000) {
      q.requestsThisMinute = 0;
      q.minuteStart = now;
    }
    if (now - q.dayStart > 86_400_000) {
      q.requestsToday = 0;
      q.tokensInToday = 0;
      q.tokensOutToday = 0;
      q.dayStart = now;
    }
    q.requestsThisMinute++;
    q.requestsToday++;

    if (result.ok) {
      q.consecutiveFailures = 0;
      return;
    }

    q.consecutiveFailures++;
    const ec = result.errorClass;

    if (ec.kind === "auth_error") {
      q.disabled = true;
      return;
    }
    if (ec.kind === "not_found") {
      q.disabled = true;
      return;
    }
    if (ec.kind === "rate_limit") {
      q.cooldownUntil = now + ec.cooldownMs;
      return;
    }
    if (
      ec.kind === "timeout" ||
      ec.kind === "server_error" ||
      ec.kind === "network_error" ||
      ec.kind === "unknown"
    ) {
      q.cooldownUntil = now + ec.cooldownMs;
      if (q.consecutiveFailures >= CIRCUIT_THRESHOLD) {
        q.cooldownUntil = now + CIRCUIT_OPEN_MS;
      }
      return;
    }
  }

  candidates(keys: string[], now: number = Date.now()): string[] {
    if (this.data.killSwitches.forceDegraded) return [];
    return keys.filter((k) => !this.isCooling(k, now));
  }

  getQuota(key: string): ModelQuota | undefined {
    return this.data.quotas[key];
  }

  getAllQuotas(): Record<string, ModelQuota> {
    return this.data.quotas;
  }

  getKillSwitches(): KillSwitches {
    return this.data.killSwitches;
  }

  setKillSwitches(ks: Partial<KillSwitches>): void {
    this.data.killSwitches = { ...this.data.killSwitches, ...ks };
  }

  disableProvider(provider: string): void {
    if (!this.data.killSwitches.disabledProviders.includes(provider)) {
      this.data.killSwitches.disabledProviders.push(provider);
    }
  }

  enableProvider(provider: string): void {
    this.data.killSwitches.disabledProviders =
      this.data.killSwitches.disabledProviders.filter((p) => p !== provider);
  }

  disableModel(key: string): void {
    if (!this.data.killSwitches.disabledModels.includes(key)) {
      this.data.killSwitches.disabledModels.push(key);
    }
  }

  enableModel(key: string): void {
    this.data.killSwitches.disabledModels =
      this.data.killSwitches.disabledModels.filter((k) => k !== key);
  }

  forceDegraded(value: boolean): void {
    this.data.killSwitches.forceDegraded = value;
  }

  reserve(
    req: ReserveRequest,
    limits: Record<string, number>,
    _now: number = Date.now()
  ): ReserveOutcome {
    if (this.data.killSwitches.forceDegraded) {
      return { ok: false, reason: "coordinator_unavailable" };
    }

    const existingLeaseId = this.data.ledger.idempotencyKeys.get(
      req.idempotencyKey
    );
    if (existingLeaseId) {
      const existing = this.data.ledger.leases.get(existingLeaseId);
      if (existing) return { ok: true, lease: existing };
    }

    for (const entry of req.entries) {
      const qk = quotaKeyToString(entry.quotaKey);
      if (this.data.killSwitches.disabledProviders.includes(entry.quotaKey.provider)) {
        return { ok: false, reason: "model_disabled", deniedEntry: entry };
      }
      const wcKey = windowCounterKey(
        qk,
        entry.window.kind,
        entry.window.start,
        entry.dimension
      );
      const wc = this.data.ledger.windows.get(wcKey);
      const limit = limits[`${qk}:${entry.window.kind}:${entry.dimension}`];
      if (limit !== undefined) {
        const total = (wc?.reserved ?? 0) + (wc?.spent ?? 0) + entry.amount;
        if (total > limit) {
          return { ok: false, reason: "quota_exhausted", deniedEntry: entry };
        }
      }
    }

    const leaseId = nanoid(16);
    const lease: Reservation = {
      leaseId,
      request: req,
      entries: req.entries,
      estimate: req.estimate,
      status: "reserved"
    };

    for (const entry of req.entries) {
      const qk = quotaKeyToString(entry.quotaKey);
      const wcKey = windowCounterKey(
        qk,
        entry.window.kind,
        entry.window.start,
        entry.dimension
      );
      let wc = this.data.ledger.windows.get(wcKey);
      if (!wc) {
        wc = {
          quotaKeyStr: qk,
          windowKind: entry.window.kind,
          windowStart: entry.window.start,
          windowEnd: entry.window.end,
          providerResetId: entry.window.providerResetId,
          dimension: entry.dimension,
          reserved: 0,
          spent: 0
        };
        this.data.ledger.windows.set(wcKey, wc);
      }
      wc.reserved += entry.amount;
    }

    this.data.ledger.leases.set(leaseId, lease);
    this.data.ledger.idempotencyKeys.set(req.idempotencyKey, leaseId);
    return { ok: true, lease };
  }

  dispatch(
    leaseId: string,
    now: number = Date.now()
  ): DispatchOutcome {
    const lease = this.data.ledger.leases.get(leaseId);
    if (!lease) return { ok: false, reason: "not_found" };
    if (lease.status === "dispatched" || lease.status === "reconciled") {
      return { ok: true, lease };
    }

    lease.status = "dispatched";
    lease.dispatchedAt = now;

    for (const entry of lease.entries) {
      const qk = quotaKeyToString(entry.quotaKey);
      const wcKey = windowCounterKey(
        qk,
        entry.window.kind,
        entry.window.start,
        entry.dimension
      );
      const wc = this.data.ledger.windows.get(wcKey);
      if (wc) {
        wc.reserved -= entry.amount;
        wc.spent += entry.amount;
      }
    }

    return { ok: true, lease };
  }

  reconcile(
    leaseId: string,
    actualUsage: Usage,
    _now: number = Date.now()
  ): ReconcileOutcome {
    const lease = this.data.ledger.leases.get(leaseId);
    if (!lease) return { ok: false, reason: "not_found" };
    if (lease.status !== "dispatched") return { ok: false, reason: "not_dispatched" };

    lease.actualUsage = actualUsage;
    lease.status = "reconciled";

    for (const entry of lease.entries) {
      const qk = quotaKeyToString(entry.quotaKey);
      const wcKey = windowCounterKey(
        qk,
        entry.window.kind,
        entry.window.start,
        entry.dimension
      );
      const wc = this.data.ledger.windows.get(wcKey);
      if (!wc) continue;

      const actualAmount = getActualAmount(entry.dimension, actualUsage);
      const diff = actualAmount - entry.amount;
      wc.spent += diff;
    }

    return { ok: true, lease };
  }

  refundLease(leaseId: string): boolean {
    const lease = this.data.ledger.leases.get(leaseId);
    if (!lease) return false;
    if (lease.status !== "reserved") return false;

    for (const entry of lease.entries) {
      const qk = quotaKeyToString(entry.quotaKey);
      const wcKey = windowCounterKey(
        qk,
        entry.window.kind,
        entry.window.start,
        entry.dimension
      );
      const wc = this.data.ledger.windows.get(wcKey);
      if (wc) {
        wc.reserved -= entry.amount;
      }
    }

    lease.status = "reconciled";
    this.data.ledger.leases.delete(leaseId);
    this.data.ledger.idempotencyKeys.delete(lease.request.idempotencyKey);
    return true;
  }

  markUnknown(leaseId: string): boolean {
    const lease = this.data.ledger.leases.get(leaseId);
    if (!lease) return false;
    lease.status = "unknown";
    return true;
  }

  getLease(leaseId: string): Reservation | undefined {
    return this.data.ledger.leases.get(leaseId);
  }

  getWindowCounter(
    quotaKeyStr: string,
    windowKind: WindowKind,
    windowStart: number,
    dimension: Dimension
  ): WindowCounter | undefined {
    return this.data.ledger.windows.get(
      windowCounterKey(quotaKeyStr, windowKind, windowStart, dimension)
    );
  }

  sweepExpiredWindows(now: number = Date.now()): number {
    let swept = 0;
    for (const [key, wc] of this.data.ledger.windows) {
      if (now >= wc.windowEnd && wc.windowEnd !== Infinity) {
        this.data.ledger.windows.delete(key);
        swept++;
      }
    }
    return swept;
  }

  private promoteFromQueue(now: number = Date.now()): void {
    while (this.data.queue.length > 0 && this.activeCount() < this.maxActive) {
      const entry = this.data.queue.shift()!;
      this.data.sessions[entry.sessionId] = {
        sessionId: entry.sessionId,
        ipHash: entry.ipHash,
        state: "active",
        lastHeartbeat: now,
        createdAt: now
      };
    }
    for (let i = 0; i < this.data.queue.length; i++) {
      this.data.queue[i].position = i + 1;
    }
  }

  private updateIpCounts(ipHash: string, now: number): void {
    if (!this.data.ipCounts[ipHash]) {
      this.data.ipCounts[ipHash] = {
        hour: 0,
        day: 0,
        hourStart: now,
        dayStart: now
      };
    }
    const ipData = this.data.ipCounts[ipHash];
    if (now - ipData.hourStart > HOUR_MS) {
      ipData.hour = 0;
      ipData.hourStart = now;
    }
    if (now - ipData.dayStart > DAY_MS) {
      ipData.day = 0;
      ipData.dayStart = now;
    }
    ipData.hour++;
    ipData.day++;
  }
}
