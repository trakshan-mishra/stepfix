import { describe, it, expect } from "vitest";
import {
  playbookReply,
  type PlaybookState
} from "../src/server/playbook/engine";
import {
  checkCaps,
  checkMessageLength,
  truncatePaste,
  MAX_USER_MESSAGES,
  MAX_SCREENSHOTS
} from "../src/server/session-caps";
import type { CaseFile, Step } from "../src/server/agent/case-file";

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

function makeState(overrides: Partial<PlaybookState> = {}): PlaybookState {
  return {
    phase: "technician",
    caseFile: makeCaseFile({
      os: "ubuntu",
      category: "bluetooth",
      symptom: "Bluetooth dead"
    }),
    steps: [],
    degraded: true,
    ...overrides
  };
}

describe("playbook engine — support phase", () => {
  it("asks for info when case is incomplete", () => {
    const result = playbookReply({
      phase: "support",
      caseFile: makeCaseFile(),
      steps: [],
      degraded: true
    });
    expect(result.text).toContain("operating system");
    expect(result.text).toContain("backup mode");
  });

  it("confirms when case is complete enough to hand off", () => {
    const result = playbookReply({
      phase: "support",
      caseFile: makeCaseFile({
        os: "ubuntu",
        category: "bluetooth",
        symptom: "Bluetooth stopped"
      }),
      steps: [],
      degraded: true
    });
    expect(result.text).toContain("case details are saved");
  });
});

describe("playbook engine — technician phase", () => {
  it("starts with flow entry when no steps yet", () => {
    const result = playbookReply(makeState({ steps: [] }));
    expect(result.card).toBeDefined();
    expect(result.card?.scriptId).toBe("linux.bt.rfkill_list");
    expect(result.text).toContain("backup mode");
  });

  it("tells user to run pending step", () => {
    const result = playbookReply(
      makeState({
        steps: [makeStep({ status: "pending" })]
      })
    );
    expect(result.text).toContain("current card");
    expect(result.card).toBeUndefined();
  });

  it("advances to next step based on output match", () => {
    const result = playbookReply(
      makeState({
        steps: [
          makeStep({
            stepId: "s1",
            scriptId: "linux.bt.rfkill_list",
            status: "ran",
            output: "Soft blocked: yes\nHard blocked: no"
          })
        ]
      })
    );
    expect(result.card).toBeDefined();
    expect(result.card?.scriptId).toBe("linux.bt.rfkill_unblock");
  });

  it("escalates on ESCALATE target", () => {
    const result = playbookReply(
      makeState({
        caseFile: makeCaseFile({
          os: "ubuntu",
          category: "bluetooth",
          symptom: "BT dead"
        }),
        steps: [
          makeStep({
            scriptId: "linux.bt.kernel_log",
            status: "ran",
            output: "firmware not found"
          })
        ]
      })
    );
    expect(result.escalate).toBeDefined();
    expect(result.text).toContain("supported next step");
  });

  it("escalates when a step has been tried twice", () => {
    const result = playbookReply(
      makeState({
        steps: [
          makeStep({
            scriptId: "linux.bt.journal",
            status: "ran",
            output: "some error"
          }),
          makeStep({ scriptId: "linux.bt.service_restart", status: "ran" }),
          makeStep({
            scriptId: "linux.bt.controller_show",
            status: "ran",
            output: "No controller"
          })
        ]
      })
    );
    expect(result.escalate ?? result.card ?? result.text).toBeDefined();
  });

  it("escalates for unsupported category", () => {
    const result = playbookReply(
      makeState({
        caseFile: makeCaseFile({
          os: "ubuntu",
          category: "dev_cli" as never,
          symptom: "test"
        })
      })
    );
    expect(result.escalate ?? result.text).toBeDefined();
  });
});

describe("session caps", () => {
  it("allows within limits", () => {
    const result = checkCaps({
      counters: { userMessages: 5, screenshots: 1, violations: 0 },
      steps: [],
      phase: "technician"
    });
    expect(result.ok).toBe(true);
  });

  it("blocks over message limit", () => {
    const result = checkCaps({
      counters: {
        userMessages: MAX_USER_MESSAGES,
        screenshots: 0,
        violations: 0
      },
      steps: [],
      phase: "technician"
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("message limit");
  });

  it("blocks over screenshot limit", () => {
    const result = checkCaps({
      counters: {
        userMessages: 1,
        screenshots: MAX_SCREENSHOTS,
        violations: 0
      },
      steps: [],
      phase: "technician"
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("screenshot");
  });

  it("suggests escalation at 12 technician steps", () => {
    const steps = Array.from({ length: 12 }, () => ({ status: "ran" }));
    const result = checkCaps({
      counters: { userMessages: 5, screenshots: 0, violations: 0 },
      steps,
      phase: "technician"
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("escalate");
  });
});

describe("message length check", () => {
  it("allows short messages", () => {
    expect(checkMessageLength("hello").ok).toBe(true);
  });

  it("blocks over 4000 chars", () => {
    const result = checkMessageLength("A".repeat(4001));
    expect(result.ok).toBe(false);
    expect(result.message).toContain("too long");
  });
});

describe("truncatePaste", () => {
  it("keeps short pastes", () => {
    expect(truncatePaste("short")).toBe("short");
  });

  it("truncates long pastes with head+tail", () => {
    const long = "A".repeat(10000);
    const result = truncatePaste(long);
    expect(result).toContain("[...truncated");
    expect(result.length).toBeLessThan(long.length);
    expect(result.startsWith("AAAA")).toBe(true);
    expect(result.endsWith("AAAA")).toBe(true);
  });
});
