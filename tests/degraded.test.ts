import { describe, it, expect } from "vitest";
import {
  captureSnapshot,
  restoreFromSnapshot,
  isRestorable,
  type DegradedSnapshot
} from "../src/server/playbook/degraded";
import type { CaseFile, Step, Phase } from "../src/server/agent/case-file";

function makeCaseFile(overrides: Partial<CaseFile> = {}): CaseFile {
  return { os: "unknown", facts: [], caseVersion: 0, ...overrides };
}

function makeStep(overrides: Partial<Step> = {}): Step {
  return {
    stepId: "s1",
    scriptId: "linux.bt.rfkill_list",
    scriptVersion: 1,
    params: {},
    whyNow: "test",
    status: "pending",
    matchedPatterns: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
    source: "llm",
    ...overrides
  };
}

describe("degraded overlay — capture and restore", () => {
  it("captures a snapshot of the current state", () => {
    const cf = makeCaseFile({
      os: "ubuntu",
      category: "bluetooth",
      symptom: "BT dead"
    });
    const steps = [makeStep({ status: "ran", output: "Soft blocked: yes" })];
    const snapshot = captureSnapshot("technician", cf, steps, 3);
    expect(snapshot.phase).toBe("technician");
    expect(snapshot.caseFile.os).toBe("ubuntu");
    expect(snapshot.steps.length).toBe(1);
    expect(snapshot.caseVersion).toBe(3);
    expect(snapshot.degradedAt).toBeGreaterThan(0);
  });

  it("restores the exact prior state from a snapshot", () => {
    const cf = makeCaseFile({
      os: "ubuntu",
      category: "bluetooth",
      symptom: "BT dead"
    });
    const steps = [makeStep({ status: "pending" })];
    const snapshot = captureSnapshot("technician", cf, steps, 5);
    const restored = restoreFromSnapshot(snapshot);
    expect(restored.phase).toBe("technician");
    expect(restored.caseFile.os).toBe("ubuntu");
    expect(restored.steps.length).toBe(1);
    expect(restored.steps[0].status).toBe("pending");
    expect(restored.caseVersion).toBe(5);
  });

  it("restoration does not reset to support phase", () => {
    const snapshot = captureSnapshot(
      "technician",
      makeCaseFile({ os: "ubuntu" }),
      [makeStep()],
      2
    );
    const restored = restoreFromSnapshot(snapshot);
    expect(restored.phase).toBe("technician");
    expect(restored.phase).not.toBe("support");
  });

  it("snapshot is a deep copy (mutations don't affect original)", () => {
    const cf = makeCaseFile({ os: "ubuntu", facts: [] });
    const steps = [makeStep({ status: "pending" })];
    const snapshot = captureSnapshot("technician", cf, steps, 1);
    cf.os = "windows11";
    steps[0].status = "ran";
    expect(snapshot.caseFile.os).toBe("ubuntu");
    expect(snapshot.steps[0].status).toBe("pending");
  });

  it("isRestorable returns true for valid snapshot with caseVersion > 0", () => {
    const snapshot: DegradedSnapshot = {
      phase: "technician",
      caseFile: makeCaseFile(),
      steps: [],
      caseVersion: 1,
      degradedAt: Date.now()
    };
    expect(isRestorable(snapshot)).toBe(true);
  });

  it("isRestorable returns false for undefined or caseVersion 0", () => {
    expect(isRestorable(undefined)).toBe(false);
    const snapshot: DegradedSnapshot = {
      phase: "support",
      caseFile: makeCaseFile(),
      steps: [],
      caseVersion: 0,
      degradedAt: Date.now()
    };
    expect(isRestorable(snapshot)).toBe(false);
  });

  it("preserves pending action through snapshot", () => {
    const snapshot = captureSnapshot("technician", makeCaseFile(), [
      makeStep({ stepId: "pending-1", status: "pending" })
    ], 4);
    const restored = restoreFromSnapshot(snapshot);
    const pendingStep = restored.steps.find((s) => s.status === "pending");
    expect(pendingStep?.stepId).toBe("pending-1");
  });
});
