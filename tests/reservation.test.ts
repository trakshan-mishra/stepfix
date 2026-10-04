import { describe, it, expect } from "vitest";
import {
  CoordinatorLogic,
  createCoordinatorData,
  computeWindow,
  createReservationLedger,
  type ReserveRequest,
  type QuotaKey
} from "../src/server/agents/coordinator-logic";

function makeQuotaKey(provider: string, quotaGroup: string): QuotaKey {
  return { provider, org: "default", project: "default", quotaGroup };
}

function makeReserveRequest(
  idempotencyKey: string,
  entries: {
    quotaKey: QuotaKey;
    dimension: string;
    amount: number;
    windowKind: string;
    windowStart: number;
    windowEnd: number;
  }[],
  estimate?: { inputTokens: number; maxOutputTokens: number }
): ReserveRequest {
  return {
    requestId: `req-${idempotencyKey}`,
    sessionId: "s1",
    turnId: "t1",
    attempt: 1,
    configVersion: "v1",
    idempotencyKey,
    entries: entries.map((e) => ({
      quotaKey: e.quotaKey,
      window: {
        kind: e.windowKind as "minute" | "hour" | "day" | "concurrency",
        start: e.windowStart,
        end: e.windowEnd,
        providerResetId: "test"
      },
      dimension: e.dimension as never,
      amount: e.amount
    })),
    estimate: estimate ?? { inputTokens: 100, maxOutputTokens: 50 }
  };
}

describe("reservation lifecycle", () => {
  it("reserve creates a lease and increments reserved", () => {
    const c = new CoordinatorLogic(createCoordinatorData());
    const qk = makeQuotaKey("groq", "groq-org-text");
    const w = computeWindow("groq", "day", 1700000000000);
    const req = makeReserveRequest("idem-1", [
      {
        quotaKey: qk,
        dimension: "requests",
        amount: 1,
        windowKind: w.kind,
        windowStart: w.start,
        windowEnd: w.end
      }
    ]);
    const limits: Record<string, number> = {
      "groq:default:default:groq-org-text:day:requests": 10
    };
    const result = c.reserve(req, limits);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.lease.status).toBe("reserved");
      const wc = c.getWindowCounter(
        "groq:default:default:groq-org-text",
        "day",
        w.start,
        "requests"
      );
      expect(wc?.reserved).toBe(1);
      expect(wc?.spent).toBe(0);
    }
  });

  it("reserve denies when quota exhausted", () => {
    const c = new CoordinatorLogic(createCoordinatorData());
    const qk = makeQuotaKey("groq", "groq-org-text");
    const w = computeWindow("groq", "day", 1700000000000);
    const limits: Record<string, number> = {
      "groq:default:default:groq-org-text:day:requests": 5
    };
    const req = makeReserveRequest("idem-1", [
      {
        quotaKey: qk,
        dimension: "requests",
        amount: 5,
        windowKind: w.kind,
        windowStart: w.start,
        windowEnd: w.end
      }
    ]);
    expect(c.reserve(req, limits).ok).toBe(true);

    const req2 = makeReserveRequest("idem-2", [
      {
        quotaKey: qk,
        dimension: "requests",
        amount: 1,
        windowKind: w.kind,
        windowStart: w.start,
        windowEnd: w.end
      }
    ]);
    const result2 = c.reserve(req2, limits);
    expect(result2.ok).toBe(false);
    if (!result2.ok) expect(result2.reason).toBe("quota_exhausted");
  });

  it("concurrent reserve races are serial (second denied after first fills quota)", () => {
    const c = new CoordinatorLogic(createCoordinatorData());
    const qk = makeQuotaKey("groq", "groq-org-text");
    const w = computeWindow("groq", "minute", 1700000000000);
    const limits: Record<string, number> = {
      "groq:default:default:groq-org-text:minute:requests": 1
    };
    const req1 = makeReserveRequest("idem-a", [
      {
        quotaKey: qk,
        dimension: "requests",
        amount: 1,
        windowKind: w.kind,
        windowStart: w.start,
        windowEnd: w.end
      }
    ]);
    const req2 = makeReserveRequest("idem-b", [
      {
        quotaKey: qk,
        dimension: "requests",
        amount: 1,
        windowKind: w.kind,
        windowStart: w.start,
        windowEnd: w.end
      }
    ]);
    const r1 = c.reserve(req1, limits);
    const r2 = c.reserve(req2, limits);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(false);
  });

  it("idempotency key returns same lease on duplicate reserve", () => {
    const c = new CoordinatorLogic(createCoordinatorData());
    const qk = makeQuotaKey("groq", "groq-org-text");
    const w = computeWindow("groq", "day", 1700000000000);
    const limits: Record<string, number> = {};
    const req = makeReserveRequest("idem-same", [
      {
        quotaKey: qk,
        dimension: "requests",
        amount: 1,
        windowKind: w.kind,
        windowStart: w.start,
        windowEnd: w.end
      }
    ]);
    const r1 = c.reserve(req, limits);
    const r2 = c.reserve(req, limits);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) expect(r2.lease.leaseId).toBe(r1.lease.leaseId);
  });

  it("dispatch moves reserved to spent", () => {
    const c = new CoordinatorLogic(createCoordinatorData());
    const qk = makeQuotaKey("groq", "groq-org-text");
    const w = computeWindow("groq", "day", 1700000000000);
    const limits: Record<string, number> = {};
    const req = makeReserveRequest("idem-1", [
      {
        quotaKey: qk,
        dimension: "requests",
        amount: 3,
        windowKind: w.kind,
        windowStart: w.start,
        windowEnd: w.end
      }
    ]);
    const result = c.reserve(req, limits);
    if (!result.ok) throw new Error("reserve failed");
    const leaseId = result.lease.leaseId;

    const disp = c.dispatch(leaseId);
    expect(disp.ok).toBe(true);
    if (disp.ok) expect(disp.lease.status).toBe("dispatched");

    const wc = c.getWindowCounter(
      "groq:default:default:groq-org-text",
      "day",
      w.start,
      "requests"
    );
    expect(wc?.reserved).toBe(0);
    expect(wc?.spent).toBe(3);
  });

  it("duplicate dispatch returns stored status without re-dispatching", () => {
    const c = new CoordinatorLogic(createCoordinatorData());
    const qk = makeQuotaKey("groq", "groq-org-text");
    const w = computeWindow("groq", "day", 1700000000000);
    const limits: Record<string, number> = {};
    const req = makeReserveRequest("idem-1", [
      {
        quotaKey: qk,
        dimension: "requests",
        amount: 3,
        windowKind: w.kind,
        windowStart: w.start,
        windowEnd: w.end
      }
    ]);
    const result = c.reserve(req, limits);
    if (!result.ok) throw new Error("reserve failed");
    const leaseId = result.lease.leaseId;

    const d1 = c.dispatch(leaseId);
    const d2 = c.dispatch(leaseId);
    expect(d1.ok).toBe(true);
    expect(d2.ok).toBe(true);
    if (d1.ok && d2.ok) {
      expect(d2.lease.leaseId).toBe(d1.lease.leaseId);
      expect(d2.lease.status).toBe("dispatched");
    }
    const wc = c.getWindowCounter(
      "groq:default:default:groq-org-text",
      "day",
      w.start,
      "requests"
    );
    expect(wc?.spent).toBe(3);
  });

  it("dispatch not found for unknown lease", () => {
    const c = new CoordinatorLogic(createCoordinatorData());
    const result = c.dispatch("nonexistent");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_found");
  });

  it("reconcile refunds over-reserve", () => {
    const c = new CoordinatorLogic(createCoordinatorData());
    const qk = makeQuotaKey("groq", "groq-org-text");
    const w = computeWindow("groq", "day", 1700000000000);
    const limits: Record<string, number> = {};
    const req = makeReserveRequest("idem-1", [
      {
        quotaKey: qk,
        dimension: "totalTokens",
        amount: 200,
        windowKind: w.kind,
        windowStart: w.start,
        windowEnd: w.end
      }
    ]);
    const result = c.reserve(req, limits);
    if (!result.ok) throw new Error("reserve failed");
    c.dispatch(result.lease.leaseId);

    const recon = c.reconcile(result.lease.leaseId, {
      totalTokens: 50
    });
    expect(recon.ok).toBe(true);
    if (recon.ok) expect(recon.lease.status).toBe("reconciled");

    const wc = c.getWindowCounter(
      "groq:default:default:groq-org-text",
      "day",
      w.start,
      "totalTokens"
    );
    expect(wc?.spent).toBe(50);
  });

  it("reconcile charges under-reserve (actual > reserved)", () => {
    const c = new CoordinatorLogic(createCoordinatorData());
    const qk = makeQuotaKey("groq", "groq-org-text");
    const w = computeWindow("groq", "day", 1700000000000);
    const limits: Record<string, number> = {};
    const req = makeReserveRequest("idem-1", [
      {
        quotaKey: qk,
        dimension: "totalTokens",
        amount: 100,
        windowKind: w.kind,
        windowStart: w.start,
        windowEnd: w.end
      }
    ]);
    const result = c.reserve(req, limits);
    if (!result.ok) throw new Error("reserve failed");
    c.dispatch(result.lease.leaseId);

    c.reconcile(result.lease.leaseId, { totalTokens: 150 });
    const wc = c.getWindowCounter(
      "groq:default:default:groq-org-text",
      "day",
      w.start,
      "totalTokens"
    );
    expect(wc?.spent).toBe(150);
  });

  it("undispatched lease refunds reserved amount", () => {
    const c = new CoordinatorLogic(createCoordinatorData());
    const qk = makeQuotaKey("groq", "groq-org-text");
    const w = computeWindow("groq", "day", 1700000000000);
    const limits: Record<string, number> = {};
    const req = makeReserveRequest("idem-1", [
      {
        quotaKey: qk,
        dimension: "requests",
        amount: 5,
        windowKind: w.kind,
        windowStart: w.start,
        windowEnd: w.end
      }
    ]);
    const result = c.reserve(req, limits);
    if (!result.ok) throw new Error("reserve failed");

    const refunded = c.refundLease(result.lease.leaseId);
    expect(refunded).toBe(true);

    const wc = c.getWindowCounter(
      "groq:default:default:groq-org-text",
      "day",
      w.start,
      "requests"
    );
    expect(wc?.reserved).toBe(0);
    expect(wc?.spent).toBe(0);
  });

  it("refund fails for already-dispatched lease", () => {
    const c = new CoordinatorLogic(createCoordinatorData());
    const qk = makeQuotaKey("groq", "groq-org-text");
    const w = computeWindow("groq", "day", 1700000000000);
    const limits: Record<string, number> = {};
    const req = makeReserveRequest("idem-1", [
      {
        quotaKey: qk,
        dimension: "requests",
        amount: 3,
        windowKind: w.kind,
        windowStart: w.start,
        windowEnd: w.end
      }
    ]);
    const result = c.reserve(req, limits);
    if (!result.ok) throw new Error("reserve failed");
    c.dispatch(result.lease.leaseId);

    const refunded = c.refundLease(result.lease.leaseId);
    expect(refunded).toBe(false);
  });

  it("crash-after-dispatch charged conservatively (spent remains)", () => {
    const c = new CoordinatorLogic(createCoordinatorData());
    const qk = makeQuotaKey("groq", "groq-org-text");
    const w = computeWindow("groq", "day", 1700000000000);
    const limits: Record<string, number> = {};
    const req = makeReserveRequest("idem-1", [
      {
        quotaKey: qk,
        dimension: "requests",
        amount: 3,
        windowKind: w.kind,
        windowStart: w.start,
        windowEnd: w.end
      }
    ]);
    const result = c.reserve(req, limits);
    if (!result.ok) throw new Error("reserve failed");
    c.dispatch(result.lease.leaseId);

    c.markUnknown(result.lease.leaseId);
    const lease = c.getLease(result.lease.leaseId);
    expect(lease?.status).toBe("unknown");

    const wc = c.getWindowCounter(
      "groq:default:default:groq-org-text",
      "day",
      w.start,
      "requests"
    );
    expect(wc?.spent).toBe(3);
  });

  it("coordinator unavailable (forceDegraded) denies reserve", () => {
    const c = new CoordinatorLogic(createCoordinatorData());
    c.forceDegraded(true);
    const qk = makeQuotaKey("groq", "groq-org-text");
    const w = computeWindow("groq", "day", 1700000000000);
    const req = makeReserveRequest("idem-1", [
      {
        quotaKey: qk,
        dimension: "requests",
        amount: 1,
        windowKind: w.kind,
        windowStart: w.start,
        windowEnd: w.end
      }
    ]);
    const result = c.reserve(req, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("coordinator_unavailable");
  });

  it("disabled provider denies reserve", () => {
    const c = new CoordinatorLogic(createCoordinatorData());
    c.disableProvider("groq");
    const qk = makeQuotaKey("groq", "groq-org-text");
    const w = computeWindow("groq", "day", 1700000000000);
    const req = makeReserveRequest("idem-1", [
      {
        quotaKey: qk,
        dimension: "requests",
        amount: 1,
        windowKind: w.kind,
        windowStart: w.start,
        windowEnd: w.end
      }
    ]);
    const result = c.reserve(req, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("model_disabled");
  });
});

describe("provider reset windows", () => {
  it("CF uses UTC midnight for day window", () => {
    const now = Date.UTC(2026, 8, 13, 14, 30, 0);
    const w = computeWindow("workers-ai", "day", now);
    expect(w.providerResetId).toBe("cf-00UTC");
    expect(w.start).toBe(Date.UTC(2026, 8, 13, 0, 0, 0));
    expect(w.end).toBe(Date.UTC(2026, 8, 14, 0, 0, 0));
  });

  it("Gemini uses Pacific midnight for day window", () => {
    const now = Date.UTC(2026, 8, 13, 14, 30, 0);
    const w = computeWindow("gemini", "day", now);
    expect(w.providerResetId).toBe("gemini-midnightPacific");
    expect(w.start).toBe(Date.UTC(2026, 8, 13, 0, 0, 0) - 8 * 60 * 60 * 1000);
  });

  it("Groq uses UTC midnight fallback for day window", () => {
    const now = Date.UTC(2026, 8, 13, 14, 30, 0);
    const w = computeWindow("groq", "day", now);
    expect(w.providerResetId).toBe("groq-header");
    expect(w.start).toBe(Date.UTC(2026, 8, 13, 0, 0, 0));
  });

  it("minute window is aligned to minute boundary", () => {
    const now = 1700000050000;
    const w = computeWindow("groq", "minute", now);
    expect(w.start).toBe(Math.floor(now / 60_000) * 60_000);
    expect(w.end).toBe(w.start + 60_000);
  });

  it("hour window is aligned to hour boundary", () => {
    const now = 1700005000000;
    const w = computeWindow("groq", "hour", now);
    expect(w.start).toBe(Math.floor(now / 3_600_000) * 3_600_000);
    expect(w.end).toBe(w.start + 3_600_000);
  });

  it("concurrency window has infinite end", () => {
    const w = computeWindow("groq", "concurrency", 1700000000000);
    expect(w.end).toBe(Infinity);
  });

  it("different providers get different reset IDs", () => {
    expect(computeWindow("workers-ai", "day", 0).providerResetId).toBe(
      "cf-00UTC"
    );
    expect(computeWindow("gemini", "day", 0).providerResetId).toBe(
      "gemini-midnightPacific"
    );
    expect(computeWindow("groq", "day", 0).providerResetId).toBe("groq-header");
  });
});

describe("reservation ledger data", () => {
  it("createReservationLedger returns empty maps", () => {
    const ledger = createReservationLedger();
    expect(ledger.windows.size).toBe(0);
    expect(ledger.leases.size).toBe(0);
    expect(ledger.idempotencyKeys.size).toBe(0);
  });

  it("sweepExpiredWindows removes expired windows", () => {
    const c = new CoordinatorLogic(createCoordinatorData());
    const qk = makeQuotaKey("groq", "groq-org-text");
    const pastW = {
      kind: "day" as const,
      start: 0,
      end: 1000,
      providerResetId: "test"
    };
    const req = makeReserveRequest("idem-1", [
      {
        quotaKey: qk,
        dimension: "requests",
        amount: 1,
        windowKind: pastW.kind,
        windowStart: pastW.start,
        windowEnd: pastW.end
      }
    ]);
    c.reserve(req, {});
    const swept = c.sweepExpiredWindows(2000);
    expect(swept).toBe(1);
  });
});
