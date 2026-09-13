import { createCoordinatorData, CoordinatorLogic, HARD_LIMITS } from "../src/server/agents/coordinator-logic";

export interface LoadResult {
  totalSessions: number;
  admitted: number;
  queued: number;
  rejected: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  maxLatencyMs: number;
  errors: number;
  perSession: Array<{ id: string; admitted: boolean; latencyMs: number }>;
}

export interface LoadConfig {
  sessions: number;
  maxActive: number;
  burst: boolean;
}

export function runLoadTest(config: LoadConfig): LoadResult {
  const logic = new CoordinatorLogic(createCoordinatorData(), {
    maxActive: config.maxActive,
    queueCap: 50
  });

  const latencies: number[] = [];
  let admitted = 0;
  let queued = 0;
  let rejected = 0;
  const perSession: LoadResult["perSession"] = [];

  for (let i = 0; i < config.sessions; i++) {
    const start = performance.now();
    const result = logic.admit({ ipHash: `ip-${i}` }, `s-${i}`);
    const latency = performance.now() - start;
    latencies.push(latency);

    if (result.status === "admitted") {
      admitted++;
      perSession.push({ id: `s-${i}`, admitted: true, latencyMs: latency });
    } else if (result.status === "queued") {
      queued++;
      perSession.push({ id: `s-${i}`, admitted: false, latencyMs: latency });
    } else {
      rejected++;
      perSession.push({ id: `s-${i}`, admitted: false, latencyMs: latency });
    }
  }

  latencies.sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)] ?? 0;
  const p95 = latencies[Math.floor(latencies.length * 0.95)] ?? 0;
  const max = latencies[latencies.length - 1] ?? 0;

  return {
    totalSessions: config.sessions,
    admitted,
    queued,
    rejected,
    p50LatencyMs: p50,
    p95LatencyMs: p95,
    maxLatencyMs: max,
    errors: 0,
    perSession
  };
}

export interface ReservationLoadResult {
  totalReservations: number;
  granted: number;
  denied: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
}

export function runReservationLoadTest(
  sessions: number,
  limit: number
): ReservationLoadResult {
  const logic = new CoordinatorLogic(createCoordinatorData());
  const latencies: number[] = [];
  let granted = 0;
  let denied = 0;

  const qk = {
    provider: "groq",
    org: "default",
    project: "default",
    quotaGroup: "groq-org-text"
  };
  const w = { kind: "day" as const, start: 0, end: 86400000, providerResetId: "test" };
  const limits: Record<string, number> = {
    "groq:default:default:groq-org-text:day:requests": limit
  };

  for (let i = 0; i < sessions; i++) {
    const start = performance.now();
    const result = logic.reserve(
      {
        requestId: `r-${i}`,
        sessionId: `s-${i}`,
        turnId: `t-${i}`,
        attempt: 1,
        configVersion: "v1",
        idempotencyKey: `ik-${i}`,
        entries: [{ quotaKey: qk, window: w, dimension: "requests", amount: 1 }],
        estimate: { inputTokens: 100, maxOutputTokens: 50 }
      },
      limits
    );
    const latency = performance.now() - start;
    latencies.push(latency);
    if (result.ok) granted++;
    else denied++;
  }

  latencies.sort((a, b) => a - b);
  return {
    totalReservations: sessions,
    granted,
    denied,
    p50LatencyMs: latencies[Math.floor(latencies.length * 0.5)] ?? 0,
    p95LatencyMs: latencies[Math.floor(latencies.length * 0.95)] ?? 0
  };
}

export function formatReport(
  result: LoadResult | ReservationLoadResult,
  label: string
): string {
  if ("admitted" in result) {
    return [
      `## ${label}`,
      "",
      `| Metric | Value |`,
      `|---|---|`,
      `| Total sessions | ${result.totalSessions} |`,
      `| Admitted | ${result.admitted} |`,
      `| Queued | ${result.queued} |`,
      `| Rejected | ${result.rejected} |`,
      `| P50 latency | ${result.p50LatencyMs.toFixed(2)} ms |`,
      `| P95 latency | ${result.p95LatencyMs.toFixed(2)} ms |`,
      `| Max latency | ${result.maxLatencyMs.toFixed(2)} ms |`,
      `| Errors | ${result.errors} |`
    ].join("\n");
  }
  return [
    `## ${label}`,
    "",
    `| Metric | Value |`,
    `|---|---|`,
    `| Total reservations | ${result.totalReservations} |`,
    `| Granted | ${result.granted} |`,
    `| Denied | ${result.denied} |`,
    `| P50 latency | ${result.p50LatencyMs.toFixed(2)} ms |`,
    `| P95 latency | ${result.p95LatencyMs.toFixed(2)} ms |`
  ].join("\n");
}
