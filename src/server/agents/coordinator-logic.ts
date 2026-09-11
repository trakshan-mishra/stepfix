import { nanoid } from "nanoid";

type SessionState = "active" | "queued" | "idle" | "released";

interface SessionEntry {
  sessionId: string;
  ipHash: string;
  state: SessionState;
  lastHeartbeat: number;
  createdAt: number;
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

export interface CoordinatorData {
  sessions: Record<string, SessionEntry>;
  queue: QueueEntry[];
  ipCounts: Record<string, IpCount>;
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
  return { sessions: {}, queue: [], ipCounts: {} };
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
