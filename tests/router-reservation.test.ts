import { describe, it, expect, vi } from "vitest";
import { MockLanguageModelV4 } from "ai/test";
import {
  streamTurn,
  buildReservationEntries,
  type RouterContext,
  type TurnRequest
} from "../src/server/llm/router";
import {
  createCoordinatorData,
  CoordinatorLogic,
  computeWindow,
  type ReserveRequest,
  type ReserveOutcome,
  type DispatchOutcome,
  type ReconcileOutcome,
  type Reservation
} from "../src/server/agents/coordinator-logic";
import type { ModelEntry } from "../src/server/llm/models.config";
import type { UIMessageStreamWriter } from "ai";

function makeEntry(key: string): ModelEntry {
  return {
    key,
    provider: "groq",
    modelId: key,
    roles: ["support"],
    caps: { tools: false, vision: false },
    quotaGroup: "groq-org-text",
    limits: { rpm: 30, tpm: 8000, rpd: 1000, tpd: 200000 },
    effectiveLimits: null,
    accountVerified: true,
    runtimeEnabled: true,
    freeEligibilityVerified: true,
    privacyConfigVerified: true,
    trainsOnInputs: false,
    ttftMs: 5000,
    paid: false
  };
}

function makeMockWriter(): UIMessageStreamWriter & {
  chunks: unknown[];
} {
  const chunks: unknown[] = [];
  return {
    write: (chunk: unknown) => chunks.push(chunk),
    merge: () => {},
    onError: () => {},
    chunks
  } as unknown as UIMessageStreamWriter & { chunks: unknown[] };
}

function makeTurnRequest(): TurnRequest {
  return {
    system: "test",
    messages: [
      {
        id: "m1",
        role: "user" as const,
        parts: [{ type: "text" as const, text: "hello" }]
      }
    ],
    privacyMode: false,
    envelope: { sessionId: "s1", turnId: "t1" },
    estimate: { inputTokens: 100, maxOutputTokens: 50 },
    maxSteps: 1
  };
}

function makeSuccessModel(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    provider: "mock",
    modelId: "mock-ok",
    doStream: () =>
      Promise.resolve({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "text-start", id: "t1" });
            controller.enqueue({
              type: "text-delta",
              id: "t1",
              delta: "OK"
            });
            controller.enqueue({ type: "text-end", id: "t1" });
            controller.enqueue({
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage: {
                inputTokens: {
                  total: 10,
                  noCache: 10,
                  cacheRead: undefined,
                  cacheWrite: undefined
                },
                outputTokens: {
                  total: 5,
                  text: 5,
                  reasoning: undefined
                }
              }
            });
            controller.close();
          }
        })
      })
  });
}

function makeFailModel(errorMsg: string): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    provider: "mock",
    modelId: "mock-fail",
    doStream: () =>
      Promise.resolve({
        stream: new ReadableStream({
          start(controller) {
            controller.error(new Error(errorMsg));
          }
        })
      })
  });
}

function makeMockReservation() {
  const calls: string[] = [];
  const mockLease: Reservation = {
    leaseId: "lease-1",
    request: {} as ReserveRequest,
    entries: [],
    estimate: { inputTokens: 0, maxOutputTokens: 0 },
    status: "reserved"
  };
  return {
    calls,
    reserve: vi.fn(async (): Promise<ReserveOutcome> => {
      calls.push("reserve");
      return { ok: true, lease: mockLease };
    }),
    dispatch: vi.fn(async (leaseId: string): Promise<DispatchOutcome> => {
      calls.push("dispatch");
      return {
        ok: true,
        lease: { ...mockLease, leaseId, status: "dispatched" }
      };
    }),
    reconcile: vi.fn(async (leaseId: string): Promise<ReconcileOutcome> => {
      calls.push("reconcile");
      return {
        ok: true,
        lease: { ...mockLease, leaseId, status: "reconciled" }
      };
    })
  };
}

const noChaos = {
  "429": 0,
  timeout: 0,
  cut: 0,
  all_down: 0,
  vectorize_down: 0,
  d1_down: 0
};

describe("router reservation flow", () => {
  it("returns coordinator_unavailable when reserve throws", async () => {
    const writer = makeMockWriter();
    const getModel = vi.fn(() => makeSuccessModel() as never);
    const reservation = makeMockReservation();
    reservation.reserve.mockRejectedValue(new Error("coordinator offline"));

    const ctx: RouterContext = {
      candidates: [makeEntry("groq:test")],
      getModel: getModel as never,
      report: () => {},
      isCooling: () => false,
      chaos: noChaos,
      reserve: reservation.reserve,
      dispatch: reservation.dispatch,
      reconcile: reservation.reconcile,
      limits: {},
      configVersion: "test"
    };

    await expect(
      streamTurn(ctx, "support", makeTurnRequest(), writer)
    ).resolves.toEqual({ ok: false, reason: "coordinator_unavailable" });
    expect(getModel).not.toHaveBeenCalled();
  });

  it("returns coordinator_unavailable when dispatch throws", async () => {
    const writer = makeMockWriter();
    const getModel = vi.fn(() => makeSuccessModel() as never);
    const reservation = makeMockReservation();
    reservation.dispatch.mockRejectedValue(new Error("coordinator offline"));

    const ctx: RouterContext = {
      candidates: [makeEntry("groq:test")],
      getModel: getModel as never,
      report: () => {},
      isCooling: () => false,
      chaos: noChaos,
      reserve: reservation.reserve,
      dispatch: reservation.dispatch,
      reconcile: reservation.reconcile,
      limits: {},
      configVersion: "test"
    };

    await expect(
      streamTurn(ctx, "support", makeTurnRequest(), writer)
    ).resolves.toEqual({ ok: false, reason: "coordinator_unavailable" });
    expect(getModel).not.toHaveBeenCalled();
  });

  it("no call dispatched without a reservation", async () => {
    const writer = makeMockWriter();
    const getModel = vi.fn(() => makeSuccessModel() as never);
    const reservation = makeMockReservation();
    reservation.reserve.mockResolvedValue({
      ok: false,
      reason: "quota_exhausted" as const
    });

    const ctx: RouterContext = {
      candidates: [makeEntry("groq:test")],
      getModel: getModel as never,
      report: () => {},
      isCooling: () => false,
      chaos: noChaos,
      reserve: reservation.reserve,
      dispatch: reservation.dispatch,
      reconcile: reservation.reconcile,
      limits: {},
      configVersion: "test"
    };

    const result = await streamTurn(ctx, "support", makeTurnRequest(), writer);
    expect(result.ok).toBe(false);
    expect(getModel).not.toHaveBeenCalled();
    expect(reservation.dispatch).not.toHaveBeenCalled();
  });

  it("reserve is called before dispatch and getModel", async () => {
    const writer = makeMockWriter();
    const reservation = makeMockReservation();
    const getModel = vi.fn(() => makeSuccessModel() as never);

    const ctx: RouterContext = {
      candidates: [makeEntry("groq:test")],
      getModel: getModel as never,
      report: () => {},
      isCooling: () => false,
      chaos: noChaos,
      reserve: reservation.reserve,
      dispatch: reservation.dispatch,
      reconcile: reservation.reconcile,
      limits: {},
      configVersion: "test"
    };

    await streamTurn(ctx, "support", makeTurnRequest(), writer);
    expect(reservation.reserve).toHaveBeenCalledBefore(reservation.dispatch);
    expect(reservation.dispatch).toHaveBeenCalled();
    expect(getModel).toHaveBeenCalled();
  });

  it("3rd failure returns quota_denied when all candidates exhausted", async () => {
    const writer = makeMockWriter();
    const reservation = makeMockReservation();
    reservation.reserve.mockResolvedValue({
      ok: false,
      reason: "quota_exhausted" as const
    });
    const entries = [
      makeEntry("groq:a"),
      makeEntry("groq:b"),
      makeEntry("groq:c")
    ];

    const ctx: RouterContext = {
      candidates: entries,
      getModel: vi.fn(() => makeSuccessModel() as never),
      report: () => {},
      isCooling: () => false,
      chaos: noChaos,
      reserve: reservation.reserve,
      dispatch: reservation.dispatch,
      reconcile: reservation.reconcile,
      limits: {},
      configVersion: "test"
    };

    const result = await streamTurn(ctx, "support", makeTurnRequest(), writer);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("quota_denied");
    expect(reservation.reserve).toHaveBeenCalledTimes(3);
    expect(reservation.dispatch).not.toHaveBeenCalled();
  });

  it("coordinator_unavailable stops before a live call", async () => {
    const writer = makeMockWriter();
    const getModel = vi.fn(() => makeSuccessModel() as never);
    const reservation = makeMockReservation();
    reservation.reserve.mockResolvedValue({
      ok: false,
      reason: "coordinator_unavailable" as const
    });

    const ctx: RouterContext = {
      candidates: [makeEntry("groq:test")],
      getModel: getModel as never,
      report: () => {},
      isCooling: () => false,
      chaos: noChaos,
      reserve: reservation.reserve,
      dispatch: reservation.dispatch,
      reconcile: reservation.reconcile,
      limits: {},
      configVersion: "test"
    };

    const result = await streamTurn(ctx, "support", makeTurnRequest(), writer);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("coordinator_unavailable");
    expect(getModel).not.toHaveBeenCalled();
  });

  it("quota_exhausted tries next candidate", async () => {
    const writer = makeMockWriter();
    const reservation = makeMockReservation();
    const successModel = makeSuccessModel();
    let callCount = 0;
    const getModel = vi.fn(() => {
      callCount++;
      return successModel as never;
    });

    const entries = [makeEntry("groq:a"), makeEntry("groq:b")];

    const ctx: RouterContext = {
      candidates: entries,
      getModel: getModel as never,
      report: () => {},
      isCooling: () => false,
      chaos: noChaos,
      reserve: reservation.reserve,
      dispatch: reservation.dispatch,
      reconcile: reservation.reconcile,
      limits: {},
      configVersion: "test"
    };

    const result = await streamTurn(ctx, "support", makeTurnRequest(), writer);
    expect(result.ok).toBe(true);
    expect(reservation.reserve).toHaveBeenCalled();
  });
});

describe("buildReservationEntries", () => {
  it("includes requests and totalTokens for minute and day windows", () => {
    const entry = makeEntry("groq:test");
    const entries = buildReservationEntries(
      entry,
      { inputTokens: 100, maxOutputTokens: 50 },
      1700000000000
    );
    const dimensions = entries.map((e) => `${e.window.kind}:${e.dimension}`);
    expect(dimensions).toContain("minute:requests");
    expect(dimensions).toContain("minute:totalTokens");
    expect(dimensions).toContain("day:requests");
    expect(dimensions).toContain("day:totalTokens");
  });

  it("includes neurons for CF models", () => {
    const entry: ModelEntry = {
      key: "workers-ai:test",
      provider: "workers-ai",
      modelId: "@cf/test",
      roles: ["support"],
      caps: { tools: true, vision: false },
      quotaGroup: "cf-account-neurons",
      limits: {},
      effectiveLimits: null,
      neuronRate: { inputPerMillion: 5500, outputPerMillion: 36400 },
      accountVerified: true,
      runtimeEnabled: true,
      freeEligibilityVerified: true,
      privacyConfigVerified: true,
      trainsOnInputs: false,
      ttftMs: 5000,
      paid: false
    };
    const entries = buildReservationEntries(
      entry,
      { inputTokens: 700, maxOutputTokens: 100 },
      1700000000000
    );
    const neuronEntry = entries.find((e) => e.dimension === "neurons");
    expect(neuronEntry).toBeDefined();
    expect(neuronEntry?.amount).toBeGreaterThan(0);
  });

  it("TPM denies before RPM when TPM is exhausted", () => {
    const logic = new CoordinatorLogic(createCoordinatorData());
    const qk = {
      provider: "groq",
      org: "default",
      project: "default",
      quotaGroup: "groq-org-text"
    };
    const minuteW = computeWindow("groq", "minute", 1700000000000);

    const limits: Record<string, number> = {
      "groq:default:default:groq-org-text:minute:requests": 30,
      "groq:default:default:groq-org-text:minute:totalTokens": 100
    };

    const req: ReserveRequest = {
      requestId: "r1",
      sessionId: "s1",
      turnId: "t1",
      attempt: 1,
      configVersion: "v1",
      idempotencyKey: "ik1",
      entries: [
        {
          quotaKey: qk,
          window: minuteW,
          dimension: "totalTokens",
          amount: 150
        },
        {
          quotaKey: qk,
          window: minuteW,
          dimension: "requests",
          amount: 1
        }
      ],
      estimate: { inputTokens: 100, maxOutputTokens: 50 }
    };

    const result = logic.reserve(req, limits);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("quota_exhausted");
      expect(result.deniedEntry?.dimension).toBe("totalTokens");
    }
  });

  it("RPM allows when TPM has room", () => {
    const logic = new CoordinatorLogic(createCoordinatorData());
    const qk = {
      provider: "groq",
      org: "default",
      project: "default",
      quotaGroup: "groq-org-text"
    };
    const minuteW = computeWindow("groq", "minute", 1700000000000);

    const limits: Record<string, number> = {
      "groq:default:default:groq-org-text:minute:requests": 30,
      "groq:default:default:groq-org-text:minute:totalTokens": 8000
    };

    const req: ReserveRequest = {
      requestId: "r1",
      sessionId: "s1",
      turnId: "t1",
      attempt: 1,
      configVersion: "v1",
      idempotencyKey: "ik1",
      entries: [
        {
          quotaKey: qk,
          window: minuteW,
          dimension: "totalTokens",
          amount: 150
        },
        {
          quotaKey: qk,
          window: minuteW,
          dimension: "requests",
          amount: 1
        }
      ],
      estimate: { inputTokens: 100, maxOutputTokens: 50 }
    };

    const result = logic.reserve(req, limits);
    expect(result.ok).toBe(true);
  });
});

describe("buildReservationEntries: multi-step turns", () => {
  it("reserves every model call a turn may make, not just one", async () => {
    const { buildReservationEntries } =
      await import("../src/server/llm/router");
    const { buildRegistry } = await import("../src/server/llm/models.config");
    const groq = buildRegistry({}).find((e) => e.key === "groq:gpt-oss-20b")!;
    const now = Date.UTC(2026, 9, 4, 12, 0, 0);

    const single = buildReservationEntries(
      groq,
      { inputTokens: 1500, maxOutputTokens: 800 },
      now
    );
    const triple = buildReservationEntries(
      groq,
      { inputTokens: 1500, maxOutputTokens: 800, requests: 3 },
      now
    );

    const amount = (entries: typeof single, dim: string, kind: string) =>
      entries.find((e) => e.dimension === dim && e.window.kind === kind)!
        .amount;

    expect(amount(single, "requests", "minute")).toBe(1);
    expect(amount(triple, "requests", "minute")).toBe(3);
    expect(amount(single, "totalTokens", "minute")).toBe(2300);
    expect(amount(triple, "totalTokens", "minute")).toBe(6900);
  });
});
