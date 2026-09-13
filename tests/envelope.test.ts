import { describe, it, expect } from "vitest";
import {
  CoordinatorLogic,
  createCoordinatorData,
  HARD_LIMITS,
  type AdmissionRequest,
  type SessionEnvelope
} from "../src/server/agents/coordinator-logic";

function makeEnvelopeDemand(
  overrides: Partial<SessionEnvelope["remaining"]> = {}
): SessionEnvelope["remaining"] {
  return {
    lightCalls: HARD_LIMITS.lightCalls,
    heavyCalls: HARD_LIMITS.heavyCalls,
    vlmFrames: HARD_LIMITS.vlmFrames,
    cloudAsrClips: HARD_LIMITS.cloudAsrClips,
    cloudAsrSeconds: HARD_LIMITS.cloudAsrSeconds,
    totalTokens: 10000,
    wallSeconds: HARD_LIMITS.wallSeconds,
    ...overrides
  };
}

function makeAdmissionReq(
  overrides: Partial<AdmissionRequest> = {}
): AdmissionRequest {
  return {
    voiceCapable: true,
    needsCloudVoice: false,
    envelopeDemand: makeEnvelopeDemand(),
    ...overrides
  };
}

describe("session envelope admission", () => {
  it("admits a session with an envelope", () => {
    const c = new CoordinatorLogic(createCoordinatorData(), {
      maxActive: 10
    });
    const result = c.admitWithEnvelope(
      makeAdmissionReq(),
      "ip1",
      "s1"
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sessionId).toBe("s1");
      expect(result.envelope.remaining.lightCalls).toBe(
        HARD_LIMITS.lightCalls
      );
      expect(result.voiceAdmitted).toBe(true);
    }
  });

  it("text mode is never counted as voice", () => {
    const c = new CoordinatorLogic(createCoordinatorData(), {
      maxActive: 10
    });
    const result = c.admitWithEnvelope(
      makeAdmissionReq({ voiceCapable: false }),
      "ip1",
      "s1"
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.voiceAdmitted).toBe(false);
    }
    expect(c.isVoiceAdmitted("s1")).toBe(false);
  });

  it("rejects when needsCloudVoice but not voiceCapable", () => {
    const c = new CoordinatorLogic(createCoordinatorData(), {
      maxActive: 10
    });
    const result = c.admitWithEnvelope(
      makeAdmissionReq({ voiceCapable: false, needsCloudVoice: true }),
      "ip1",
      "s1"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("voice_unavailable");
  });

  it("70% normal ceiling queues beyond 70%", () => {
    const c = new CoordinatorLogic(createCoordinatorData(), {
      maxActive: 10
    });
    for (let i = 0; i < 7; i++) {
      const r = c.admitWithEnvelope(
        makeAdmissionReq(),
        `ip${i}`,
        `s${i}`
      );
      expect(r.ok).toBe(true);
    }
    const result = c.admitWithEnvelope(
      makeAdmissionReq(),
      "ip-overflow",
      "s-overflow"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("queued");
  });

  it("envelope exhaustion returns further analysis paused", () => {
    const c = new CoordinatorLogic(createCoordinatorData(), {
      maxActive: 10
    });
    c.admitWithEnvelope(
      makeAdmissionReq({
        envelopeDemand: makeEnvelopeDemand({ lightCalls: 1 })
      }),
      "ip1",
      "s1"
    );

    const r1 = c.consumeEnvelope("s1", { lightCalls: 1 });
    expect(r1.ok).toBe(true);

    const r2 = c.consumeEnvelope("s1", { lightCalls: 1 });
    expect(r2.ok).toBe(false);
    if (!r2.ok) {
      expect(r2.reason).toBe("envelope_exhausted");
      expect(r2.message).toContain("Further analysis paused");
    }
  });

  it("double-count guard: consume decrements remaining", () => {
    const c = new CoordinatorLogic(createCoordinatorData(), {
      maxActive: 10
    });
    c.admitWithEnvelope(
      makeAdmissionReq({
        envelopeDemand: makeEnvelopeDemand({ lightCalls: 2 })
      }),
      "ip1",
      "s1"
    );

    const r1 = c.consumeEnvelope("s1", { lightCalls: 1 });
    expect(r1.ok).toBe(true);
    if (r1.ok) expect(r1.remaining.lightCalls).toBe(1);

    const r2 = c.consumeEnvelope("s1", { lightCalls: 1 });
    expect(r2.ok).toBe(true);
    if (r2.ok) expect(r2.remaining.lightCalls).toBe(0);

    const r3 = c.consumeEnvelope("s1", { lightCalls: 1 });
    expect(r3.ok).toBe(false);
  });

  it("wall time limit enforced", () => {
    const c = new CoordinatorLogic(createCoordinatorData(), {
      maxActive: 10
    });
    const now = Date.now();
    c.admitWithEnvelope(
      makeAdmissionReq(),
      "ip1",
      "s1",
      now
    );

    const future = now + (HARD_LIMITS.wallSeconds + 10) * 1000;
    const r = c.consumeEnvelope("s1", { lightCalls: 1 }, future);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("time limit");
  });

  it("per-IP limits enforced", () => {
    const c = new CoordinatorLogic(createCoordinatorData(), {
      maxActive: 100,
      perIpHourly: 3,
      perIpDaily: 10
    });
    for (let i = 0; i < 3; i++) {
      c.admitWithEnvelope(makeAdmissionReq(), "ip1", `s${i}`);
    }
    const result = c.admitWithEnvelope(
      makeAdmissionReq(),
      "ip1",
      "s-overflow"
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("per_ip");
  });

  it("getEnvelope returns current envelope", () => {
    const c = new CoordinatorLogic(createCoordinatorData(), {
      maxActive: 10
    });
    c.admitWithEnvelope(
      makeAdmissionReq({
        envelopeDemand: makeEnvelopeDemand({ lightCalls: 3 })
      }),
      "ip1",
      "s1"
    );
    const envelope = c.getEnvelope("s1");
    expect(envelope?.remaining.lightCalls).toBe(3);
  });

  it("hard limits are correct values", () => {
    expect(HARD_LIMITS.wallSeconds).toBe(600);
    expect(HARD_LIMITS.wallWarningSeconds).toBe(480);
    expect(HARD_LIMITS.cloudAsrClips).toBe(12);
    expect(HARD_LIMITS.cloudAsrSeconds).toBe(180);
    expect(HARD_LIMITS.lightCalls).toBe(4);
    expect(HARD_LIMITS.heavyCalls).toBe(2);
    expect(HARD_LIMITS.vlmFrames).toBe(6);
  });
});
