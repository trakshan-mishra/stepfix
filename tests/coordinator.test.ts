import { describe, it, expect } from "vitest";
import {
  CoordinatorLogic,
  createCoordinatorData,
  computeWindow,
  reviveCoordinatorData,
  type ReserveRequest
} from "../src/server/agents/coordinator-logic";

function makeLogic(maxActive = 20) {
  return new CoordinatorLogic(createCoordinatorData(), { maxActive });
}

function makeReserveRequest(): ReserveRequest {
  return {
    requestId: "request-1",
    sessionId: "session-1",
    turnId: "turn-1",
    attempt: 1,
    configVersion: "test",
    idempotencyKey: "session-1-turn-1-1",
    entries: [
      {
        quotaKey: {
          provider: "groq",
          org: "default",
          project: "default",
          quotaGroup: "groq-org-text"
        },
        window: computeWindow("groq", "minute", 1_700_000_000_000),
        dimension: "requests",
        amount: 1
      }
    ],
    estimate: { inputTokens: 100, maxOutputTokens: 50 }
  };
}

describe("Coordinator state revival", () => {
  it("preserves leases and idempotency keys through JSON persistence", () => {
    const data = createCoordinatorData();
    const first = new CoordinatorLogic(data).reserve(makeReserveRequest(), {});
    expect(first.ok).toBe(true);

    const revived = reviveCoordinatorData(JSON.parse(JSON.stringify(data)));
    const second = new CoordinatorLogic(revived).reserve(
      makeReserveRequest(),
      {}
    );

    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(revived.ledger.leases.get(first.lease.leaseId)).toEqual(
        first.lease
      );
      expect(revived.ledger.idempotencyKeys.get("session-1-turn-1-1")).toBe(
        first.lease.leaseId
      );
      expect(second.lease.leaseId).toBe(first.lease.leaseId);
    }
  });

  it("revives the old corrupted ledger shape", () => {
    const revived = reviveCoordinatorData({
      ...createCoordinatorData(),
      ledger: { windows: {}, leases: {}, idempotencyKeys: {} }
    });

    expect(() =>
      new CoordinatorLogic(revived).reserve(makeReserveRequest(), {})
    ).not.toThrow();
  });
});

describe("Coordinator admission", () => {
  it("admits when under cap", () => {
    const c = makeLogic(3);
    const result = c.admit({ ipHash: "ip1" }, "s1");
    expect(result.status).toBe("admitted");
    if (result.status === "admitted") expect(result.sessionId).toBe("s1");
  });

  it("admits multiple sessions up to cap", () => {
    const c = makeLogic(3);
    c.admit({ ipHash: "ip1" }, "s1");
    c.admit({ ipHash: "ip1" }, "s2");
    const r3 = c.admit({ ipHash: "ip1" }, "s3");
    expect(r3.status).toBe("admitted");
  });

  it("queues when at cap", () => {
    const c = makeLogic(1);
    c.admit({ ipHash: "ip1" }, "s1");
    const result = c.admit({ ipHash: "ip1" }, "s2");
    expect(result.status).toBe("queued");
    if (result.status === "queued") {
      expect(result.position).toBe(1);
      expect(result.ticket).toBeDefined();
    }
  });

  it("rejects when queue is full", () => {
    const c = makeLogic(1);
    c.admit({ ipHash: "ip1" }, "s1");
    for (let i = 0; i < 50; i++) {
      c.admit({ ipHash: `ip${i + 2}` }, `s${i + 2}`);
    }
    const result = c.admit({ ipHash: "ip-overflow" }, "overflow");
    expect(result.status).toBe("rejected");
    if (result.status === "rejected") expect(result.reason).toBe("queue_full");
  });

  it("promotes from queue on release", () => {
    const c = makeLogic(1);
    c.admit({ ipHash: "ip1" }, "s1");
    const queued = c.admit({ ipHash: "ip1" }, "s2");
    expect(queued.status).toBe("queued");
    c.release("s1");
    if (queued.status === "queued") {
      const check = c.checkQueue(queued.ticket);
      expect(check.status).toBe("admitted");
      if (check.status === "admitted") expect(check.sessionId).toBe("s2");
    }
  });

  it("maintains queue order", () => {
    const c = makeLogic(1);
    c.admit({ ipHash: "ip1" }, "s1");
    const q1 = c.admit({ ipHash: "ip1" }, "s2");
    const q2 = c.admit({ ipHash: "ip1" }, "s3");
    c.release("s1");
    if (q1.status === "queued" && q2.status === "queued") {
      const check1 = c.checkQueue(q1.ticket);
      expect(check1.status).toBe("admitted");
      const check2 = c.checkQueue(q2.ticket);
      expect(check2.status).toBe("queued");
      if (check2.status === "queued") expect(check2.position).toBe(1);
    }
  });

  it("updates heartbeat", () => {
    const c = makeLogic(3);
    c.admit({ ipHash: "ip1" }, "s1");
    const before = c.data.sessions["s1"].lastHeartbeat;
    c.heartbeat("s1", before + 5000);
    expect(c.data.sessions["s1"].lastHeartbeat).toBe(before + 5000);
  });

  it("expires a queue ticket that doesn't exist", () => {
    const c = makeLogic(1);
    const result = c.checkQueue("nonexistent");
    expect(result.status).toBe("expired");
  });
});

describe("Coordinator per-IP limits", () => {
  it("allows within hourly limit", () => {
    const c = makeLogic(100);
    for (let i = 0; i < 3; i++) {
      const r = c.admit({ ipHash: "ip1" }, `s${i}`);
      expect(r.status).toBe("admitted");
    }
  });

  it("rejects over hourly limit (3/hour)", () => {
    const c = makeLogic(100);
    c.admit({ ipHash: "ip1" }, "s1");
    c.admit({ ipHash: "ip1" }, "s2");
    c.admit({ ipHash: "ip1" }, "s3");
    const r = c.admit({ ipHash: "ip1" }, "s4");
    expect(r.status).toBe("rejected");
    if (r.status === "rejected") expect(r.reason).toBe("per_ip_limit");
  });

  it("allows different IPs independently", () => {
    const c = makeLogic(100);
    c.admit({ ipHash: "ip1" }, "s1");
    c.admit({ ipHash: "ip1" }, "s2");
    c.admit({ ipHash: "ip1" }, "s3");
    const r = c.admit({ ipHash: "ip2" }, "s4");
    expect(r.status).toBe("admitted");
  });
});

describe("Coordinator release and sweep", () => {
  it("removes a session on release", () => {
    const c = makeLogic(3);
    c.admit({ ipHash: "ip1" }, "s1");
    expect(c.data.sessions["s1"]).toBeDefined();
    c.release("s1");
    expect(c.data.sessions["s1"]).toBeUndefined();
  });

  it("does nothing on release of unknown session", () => {
    const c = makeLogic(3);
    c.release("nonexistent");
    expect(Object.keys(c.data.sessions)).toHaveLength(0);
  });

  it("sweeps idle sessions after 10 min", () => {
    const c = makeLogic(3);
    const now = Date.now();
    c.admit({ ipHash: "ip1" }, "s1", now);
    c.heartbeat("s1", now);
    // simulate 11 min of inactivity
    c.sweepIdle(now + 11 * 60 * 1000);
    expect(c.data.sessions["s1"]).toBeUndefined();
  });

  it("does not sweep active sessions", () => {
    const c = makeLogic(3);
    const now = Date.now();
    c.admit({ ipHash: "ip1" }, "s1", now);
    c.heartbeat("s1", now + 5 * 60 * 1000);
    c.sweepIdle(now + 6 * 60 * 1000);
    expect(c.data.sessions["s1"]).toBeDefined();
  });

  it("promotes queued session after sweep frees a slot", () => {
    const c = makeLogic(1);
    const now = Date.now();
    c.admit({ ipHash: "ip1" }, "s1", now);
    const q = c.admit({ ipHash: "ip1" }, "s2", now);
    expect(q.status).toBe("queued");
    c.sweepIdle(now + 11 * 60 * 1000);
    expect(c.data.sessions["s1"]).toBeUndefined();
    if (q.status === "queued") {
      const check = c.checkQueue(q.ticket, now + 11 * 60 * 1000);
      expect(check.status).toBe("admitted");
    }
  });
});
