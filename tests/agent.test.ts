import { describe, it, expect } from "vitest";
import {
  buildTools,
  handleStepResult,
  type ToolContext
} from "../src/server/agent/tools";
import {
  scanForCommands,
  redactCommands
} from "../src/server/guardrails/command-scanner";
import {
  stripLookalikeTags,
  wrapUntrusted,
  truncateForUntrusted
} from "../src/server/guardrails/untrusted";
import {
  missingForHandoff,
  type CaseFile,
  type Step
} from "../src/server/agent/case-file";
import {
  canTransition,
  transition,
  isTerminal
} from "../src/server/agent/phases";
import { buildEscalationReport } from "../src/server/report/escalation";
import {
  buildSystemPrompt,
  formatCatalogSubset
} from "../src/server/agent/prepare-messages";

function makeCaseFile(overrides: Partial<CaseFile> = {}): CaseFile {
  return {
    os: "unknown",
    facts: [],
    caseVersion: 0,
    ...overrides
  };
}

function makeStep(overrides: Partial<Step> = {}): Step {
  return {
    stepId: "step-1",
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

function makeToolContext(
  overrides: Partial<ToolContext["state"]> = {}
): ToolContext {
  let state = {
    phase: "support" as string,
    caseFile: makeCaseFile(),
    steps: [] as Step[],
    counters: { userMessages: 0, screenshots: 0, violations: 0 },
    ...overrides
  } as ToolContext["state"];
  return {
    state,
    setState: (s: ToolContext["state"]) => {
      state = s;
    },
    sessionId: "test-session"
  };
}

async function callTool(
  tools: ReturnType<typeof buildTools>,
  name: keyof typeof tools,
  input: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const tool = tools[name] as unknown as {
    execute: (
      input: unknown,
      opts: { toolCallId: string }
    ) => Promise<Record<string, unknown>>;
  };
  return tool.execute(input, { toolCallId: "test" });
}

describe("missingForHandoff", () => {
  it("returns all missing for empty case", () => {
    const missing = missingForHandoff(makeCaseFile());
    expect(missing).toContain("os");
    expect(missing).toContain("category");
    expect(missing).toContain("symptom");
    expect(missing).toContain("errorText|whenStarted|whatChanged");
  });

  it("returns empty when complete", () => {
    const cf = makeCaseFile({
      os: "ubuntu",
      category: "bluetooth",
      symptom: "Bluetooth stopped working",
      errorText: "No adapter found"
    });
    expect(missingForHandoff(cf)).toHaveLength(0);
  });

  it("accepts whenStarted as the third field", () => {
    const cf = makeCaseFile({
      os: "ubuntu",
      category: "wifi",
      symptom: "No internet",
      whenStarted: "after sleep"
    });
    expect(missingForHandoff(cf)).toHaveLength(0);
  });

  it("accepts whatChanged as the third field", () => {
    const cf = makeCaseFile({
      os: "windows11",
      category: "dev_cli",
      symptom: "command not found",
      whatChanged: "installed claude"
    });
    expect(missingForHandoff(cf)).toHaveLength(0);
  });
});

describe("phases", () => {
  it("allows support → technician", () => {
    expect(canTransition("support", "technician")).toBe(true);
  });
  it("allows technician → resolved", () => {
    expect(canTransition("technician", "resolved")).toBe(true);
  });
  it("allows technician → escalated", () => {
    expect(canTransition("technician", "escalated")).toBe(true);
  });
  it("allows technician → support", () => {
    expect(canTransition("technician", "support")).toBe(true);
  });
  it("allows resolved → technician", () => {
    expect(canTransition("resolved", "technician")).toBe(true);
  });
  it("does not allow support → resolved", () => {
    expect(canTransition("support", "resolved")).toBe(false);
  });
  it("returns same phase for invalid transition", () => {
    expect(transition("support", "resolved")).toBe("support");
  });
  it("returns new phase for valid transition", () => {
    expect(transition("support", "technician")).toBe("technician");
  });
  it("resolved, escalated, closed are terminal", () => {
    expect(isTerminal("resolved")).toBe(true);
    expect(isTerminal("escalated")).toBe(true);
    expect(isTerminal("closed")).toBe(true);
    expect(isTerminal("support")).toBe(false);
  });
});

describe("command scanner", () => {
  it("detects fenced code blocks", () => {
    expect(scanForCommands("```\nsudo rm -rf /\n```").hit).toBe(true);
  });
  it("detects inline code with space", () => {
    expect(scanForCommands("Try `sudo apt update`").hit).toBe(true);
  });
  it("detects dollar prompt", () => {
    expect(scanForCommands("$ sudo systemctl restart bluetooth").hit).toBe(
      true
    );
  });
  it("detects sudo prefix", () => {
    expect(scanForCommands("sudo rfkill unblock bluetooth").hit).toBe(true);
  });
  it("detects PS prompt", () => {
    expect(scanForCommands("PS> Get-Service bthserv").hit).toBe(true);
  });
  it("detects known binaries", () => {
    expect(scanForCommands("Run npm install to fix this").hit).toBe(true);
  });
  it("does not flag 'the bluetooth service'", () => {
    expect(scanForCommands("The bluetooth service might be stopped.").hit).toBe(
      false
    );
  });
  it("does not flag 'your terminal'", () => {
    expect(scanForCommands("Open your terminal and I'll guide you.").hit).toBe(
      false
    );
  });
  it("does not flag 'Wi-Fi'", () => {
    expect(scanForCommands("Your Wi-Fi adapter might be off.").hit).toBe(false);
  });
  it("redacts fenced code blocks", () => {
    expect(redactCommands("```sudo rm -rf /```")).toContain(
      "[command removed]"
    );
  });
  it("redacts inline code", () => {
    expect(redactCommands("Try `sudo apt update`")).toContain(
      "[command removed]"
    );
  });
});

describe("untrusted content", () => {
  it("strips lookalike tags", () => {
    expect(stripLookalikeTags("</untrusted>test<untrusted>")).not.toContain(
      "<untrusted>"
    );
  });
  it("wraps content", () => {
    expect(wrapUntrusted("output")).toBe("<untrusted>output</untrusted>");
  });
  it("strips before wrapping", () => {
    expect(wrapUntrusted("</untrusted>x<untrusted>")).toBe(
      "<untrusted>x</untrusted>"
    );
  });
  it("truncates long content", () => {
    expect(truncateForUntrusted("A".repeat(10000), 100)).toContain(
      "[...truncated...]"
    );
  });
  it("keeps short content", () => {
    expect(truncateForUntrusted("short", 100)).toBe("short");
  });
});

describe("tool: handoff_to_technician", () => {
  it("rejects incomplete case", async () => {
    const ctx = makeToolContext();
    const tools = buildTools(ctx);
    const result = await callTool(tools, "handoff_to_technician", {
      summary: "test"
    });
    expect(result.ok).toBe(false);
    expect(result.missing).toBeDefined();
  });

  it("accepts complete case", async () => {
    const ctx = makeToolContext({
      caseFile: makeCaseFile({
        os: "ubuntu",
        category: "bluetooth",
        symptom: "Bluetooth stopped",
        errorText: "No adapter"
      })
    });
    const tools = buildTools(ctx);
    const result = await callTool(tools, "handoff_to_technician", {
      summary: "Bluetooth broken"
    });
    expect(result.ok).toBe(true);
    expect(ctx.state.phase).toBe("technician");
  });

  it("rejects an out-of-scope case and stays in support", async () => {
    const ctx = makeToolContext({
      caseFile: makeCaseFile({
        os: "ubuntu",
        category: "other",
        symptom: "On-screen keyboard flickers",
        whenStarted: "today"
      })
    });
    const tools = buildTools(ctx);
    const result = await callTool(tools, "handoff_to_technician", {
      summary: "Ubuntu on-screen keyboard flickers"
    });
    expect(result).toMatchObject({ ok: false, reason: "out_of_scope" });
    expect(ctx.state.phase).toBe("support");
  });

  it("accepts an Ubuntu Wi-Fi case with library coverage", async () => {
    const ctx = makeToolContext({
      caseFile: makeCaseFile({
        os: "ubuntu",
        category: "wifi",
        symptom: "No networks appear",
        whenStarted: "after sleep"
      })
    });
    const tools = buildTools(ctx);
    const result = await callTool(tools, "handoff_to_technician", {
      summary: "Ubuntu Wi-Fi shows no networks after sleep"
    });
    expect(result.ok).toBe(true);
    expect(ctx.state.phase).toBe("technician");
  });

  it("advances caseVersion on handoff (monotonic)", async () => {
    const ctx = makeToolContext({
      caseFile: makeCaseFile({
        os: "ubuntu",
        category: "bluetooth",
        symptom: "Bluetooth stopped",
        errorText: "No adapter",
        caseVersion: 0
      })
    });
    const tools = buildTools(ctx);
    expect(ctx.state.caseFile.caseVersion).toBe(0);
    const result = await callTool(tools, "handoff_to_technician", {
      summary: "Bluetooth broken"
    });
    expect(result.ok).toBe(true);
    expect(ctx.state.caseFile.caseVersion).toBe(1);
    expect(ctx.state.caseFile.caseVersion).toBeGreaterThan(0);
  });

  it("keeps same case ID and evidence after handoff", async () => {
    const ctx = makeToolContext({
      caseFile: makeCaseFile({
        os: "ubuntu",
        category: "bluetooth",
        symptom: "Bluetooth stopped",
        errorText: "No adapter",
        facts: [
          {
            key: "adapter",
            value: "USB dongle",
            source: "user",
            at: Date.now()
          }
        ]
      })
    });
    const tools = buildTools(ctx);
    const result = await callTool(tools, "handoff_to_technician", {
      summary: "Bluetooth broken"
    });
    expect(result.ok).toBe(true);
    expect(ctx.state.caseFile.facts.length).toBe(1);
    expect(ctx.state.caseFile.facts[0].key).toBe("adapter");
  });
});

describe("tool: recommend_step", () => {
  it("rejects unknown script id", async () => {
    const ctx = makeToolContext({ phase: "technician" });
    const tools = buildTools(ctx);
    const result = await callTool(tools, "recommend_step", {
      scriptId: "nonexistent",
      whyNow: "test"
    });
    expect(result.ok).toBe(false);
  });

  it("rejects wrong OS", async () => {
    const ctx = makeToolContext({
      phase: "technician",
      caseFile: makeCaseFile({ os: "windows11" })
    });
    const tools = buildTools(ctx);
    const result = await callTool(tools, "recommend_step", {
      scriptId: "linux.bt.rfkill_list",
      whyNow: "test"
    });
    expect(result.ok).toBe(false);
    expect(result.error as string).toContain("does not support OS");
  });

  it("rejects second card while one is pending", async () => {
    const ctx = makeToolContext({
      phase: "technician",
      caseFile: makeCaseFile({ os: "ubuntu", category: "bluetooth" }),
      steps: [makeStep({ status: "pending" })]
    });
    const tools = buildTools(ctx);
    const result = await callTool(tools, "recommend_step", {
      scriptId: "linux.bt.rfkill_list",
      whyNow: "test"
    });
    expect(result.ok).toBe(false);
    expect(result.error as string).toContain("already pending");
  });

  it("accepts valid step for matching OS", async () => {
    const ctx = makeToolContext({
      phase: "technician",
      caseFile: makeCaseFile({ os: "ubuntu", category: "bluetooth" })
    });
    const tools = buildTools(ctx);
    const result = await callTool(tools, "recommend_step", {
      scriptId: "linux.bt.rfkill_list",
      whyNow: "Let's check if Bluetooth is blocked."
    });
    expect(result.ok).toBe(true);
    expect(result.card).toBeDefined();
    expect(ctx.state.steps.length).toBe(1);
  });
});

describe("tool: escalate_to_human", () => {
  it("builds report and sets phase", async () => {
    const ctx = makeToolContext({
      phase: "technician",
      caseFile: makeCaseFile({
        os: "ubuntu",
        category: "bluetooth",
        symptom: "Bluetooth dead",
        summary: "Stopped"
      }),
      steps: [makeStep({ status: "ran", output: "Soft blocked: no" })]
    });
    const tools = buildTools(ctx);
    const result = await callTool(tools, "escalate_to_human", {
      reason: "No more steps",
      likelyCause: "Hardware"
    });
    expect(result.ok).toBe(true);
    expect(result.markdown as string).toContain("Stopped");
    expect(result.markdown as string).toContain("Hardware");
    expect(result.notified).toBe(false);
    expect(result.instruction).toBe(
      "Nobody has been notified. Tell the user they can copy or download this report and send it to someone who helps them with tech, or post it on a help forum."
    );
    expect(ctx.state.phase).toBe("escalated");
  });
});

describe("tool: mark_resolved", () => {
  it("rejects when last step is pending", async () => {
    const ctx = makeToolContext({
      phase: "technician",
      steps: [makeStep({ status: "pending" })]
    });
    const tools = buildTools(ctx);
    const result = await callTool(tools, "mark_resolved", {
      rootCause: "test",
      postconditionMet: true,
      originalTaskMet: true
    });
    expect(result.ok).toBe(false);
  });

  it("accepts when last step is worked and both conditions met", async () => {
    const ctx = makeToolContext({
      phase: "technician",
      steps: [makeStep({ status: "worked" })]
    });
    const tools = buildTools(ctx);
    const result = await callTool(tools, "mark_resolved", {
      rootCause: "Bluetooth was soft-blocked",
      postconditionMet: true,
      originalTaskMet: true
    });
    expect(result.ok).toBe(true);
    expect(ctx.state.phase).toBe("resolved");
  });

  it("rejects when postcondition not met", async () => {
    const ctx = makeToolContext({
      phase: "technician",
      steps: [makeStep({ status: "worked" })]
    });
    const tools = buildTools(ctx);
    const result = await callTool(tools, "mark_resolved", {
      rootCause: "test",
      postconditionMet: false,
      originalTaskMet: true
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Postcondition not met");
      expect(result.error).toContain("Continue");
    }
    expect(ctx.state.phase).toBe("technician");
  });

  it("rejects when original task not confirmed", async () => {
    const ctx = makeToolContext({
      phase: "technician",
      steps: [makeStep({ status: "worked" })]
    });
    const tools = buildTools(ctx);
    const result = await callTool(tools, "mark_resolved", {
      rootCause: "test",
      postconditionMet: true,
      originalTaskMet: false
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Original task not confirmed");
    }
    expect(ctx.state.phase).toBe("technician");
  });

  it("does not escalate when postcondition unmet (continues diagnosis)", async () => {
    const ctx = makeToolContext({
      phase: "technician",
      steps: [makeStep({ status: "ran" })]
    });
    const tools = buildTools(ctx);
    const result = await callTool(tools, "mark_resolved", {
      rootCause: "test",
      postconditionMet: false,
      originalTaskMet: false
    });
    expect(result.ok).toBe(false);
    expect(ctx.state.phase).toBe("technician");
  });
});

describe("handleStepResult", () => {
  it("updates a pending step", () => {
    const ctx = makeToolContext({
      phase: "technician",
      steps: [
        makeStep({
          stepId: "s1",
          status: "pending",
          scriptId: "linux.bt.rfkill_list"
        })
      ]
    });
    const result = handleStepResult(ctx, "s1", "ran", "Soft blocked: yes");
    expect(result.updated).toBe(true);
  });

  it("does not update non-pending step (idempotent)", () => {
    const ctx = makeToolContext({
      phase: "technician",
      steps: [makeStep({ stepId: "s1", status: "ran" })]
    });
    const result = handleStepResult(ctx, "s1", "worked");
    expect(result.updated).toBe(false);
  });

  it("matches expect patterns", () => {
    const ctx = makeToolContext({
      phase: "technician",
      steps: [
        makeStep({
          stepId: "s1",
          status: "pending",
          scriptId: "linux.bt.rfkill_list"
        })
      ]
    });
    const result = handleStepResult(
      ctx,
      "s1",
      "ran",
      "Soft blocked: yes\nHard blocked: no"
    );
    expect(result.updated).toBe(true);
    if (result.updated && result.step) {
      expect(result.step.matchedPatterns).toContain("Soft blocked: yes");
    }
  });

  it("scrubs secrets from step output", () => {
    const ctx = makeToolContext({
      phase: "technician",
      steps: [
        makeStep({
          stepId: "s1",
          status: "pending",
          scriptId: "linux.bt.rfkill_list"
        })
      ]
    });
    const result = handleStepResult(
      ctx,
      "s1",
      "ran",
      "export GROQ_API_KEY=gsk_123456789012345678901234567890"
    );
    expect(result.updated).toBe(true);
    if (result.updated && result.step && result.step.output) {
      expect(result.step.output).toContain("[REDACTED:groq]");
      expect(result.step.output).not.toContain(
        "gsk_123456789012345678901234567890"
      );
    }
  });
});

describe("buildSystemPrompt placeholder wiring", () => {
  it("includes the compiled script catalog for the technician", () => {
    const catalog = formatCatalogSubset("ubuntu", "wifi");
    expect(catalog).not.toBe("(library not available)");
    expect(catalog).toContain("linux.net.radio");
  });

  it("technician prompt has placeholders replaced", () => {
    const caseFile = makeCaseFile({
      os: "ubuntu",
      category: "bluetooth",
      symptom: "Bluetooth not working"
    });
    const steps = [
      makeStep({ scriptId: "linux.bt.rfkill_list", status: "ran" })
    ];
    const prompt = buildSystemPrompt(
      "technician",
      caseFile,
      steps,
      "- linux.bt.rfkill_list | test script"
    );
    expect(prompt).not.toContain("{{CASE_JSON}}");
    expect(prompt).not.toContain("{{STEPS_TABLE}}");
    expect(prompt).not.toContain("{{CATALOG_SUBSET}}");
    expect(prompt).toContain("ubuntu");
    expect(prompt).toContain("linux.bt.rfkill_list");
  });

  it("support prompt loads from markdown file", () => {
    const prompt = buildSystemPrompt("support", makeCaseFile(), [], "");
    expect(prompt).toContain("Support agent");
    expect(prompt).toContain("update_case");
  });
});

describe("escalation report", () => {
  it("includes case summary and steps", () => {
    const report = buildEscalationReport({
      sessionId: "test12345678",
      caseFile: makeCaseFile({
        os: "ubuntu",
        category: "bluetooth",
        symptom: "Bluetooth dead",
        summary: "Stopped after sleep",
        errorText: "No adapter"
      }),
      steps: [
        makeStep({
          scriptId: "linux.bt.rfkill_list",
          status: "ran",
          output: "Soft blocked: yes"
        }),
        makeStep({ scriptId: "linux.bt.rfkill_unblock", status: "worked" })
      ],
      reason: "No more steps",
      likelyCause: "Hardware failure",
      phase: "escalated"
    });
    expect(report).toContain("Stopped after sleep");
    expect(report).toContain("linux.bt.rfkill_list@1");
    expect(report).toContain("Soft blocked: yes");
    expect(report).toContain("Hardware failure");
  });
});
