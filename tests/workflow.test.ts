import { describe, expect, it } from "vitest";
import type { Step } from "../src/server/agent/case-file";
import {
  buildTools,
  handleStepResult,
  type ToolContext
} from "../src/server/agent/tools";
import {
  decideNext,
  matchesRule,
  workflowState
} from "../src/server/agent/workflow";
import {
  executeWorkflow,
  resultFromText
} from "../src/server/agent/workflow-response";
import { playbookReply } from "../src/server/playbook/engine";
import type { UIMessageStreamWriter } from "ai";

function step(
  scriptId: string,
  status: Step["status"] = "ran",
  output?: string
): Step {
  return {
    stepId: `step-${scriptId}`,
    scriptId,
    scriptVersion: 1,
    params: {},
    whyNow: "test",
    status,
    output,
    matchedPatterns: [],
    createdAt: 1,
    updatedAt: 1,
    source: "llm"
  };
}
function context(steps: Step[] = []): ToolContext {
  const ctx: ToolContext = {
    sessionId: "workflow-test",
    state: {
      phase: "technician",
      caseFile: {
        os: "ubuntu",
        category: "wifi",
        symptom: "Websites do not load",
        originalTask: "Load websites",
        facts: [],
        caseVersion: 1
      },
      steps,
      counters: { userMessages: 1, screenshots: 0, violations: 0 }
    },
    setState(state) {
      ctx.state = state;
    }
  };
  return ctx;
}
function capture() {
  const chunks: Array<Parameters<UIMessageStreamWriter["write"]>[0]> = [];
  const writer = {
    write: (chunk: (typeof chunks)[number]) => chunks.push(chunk)
  } as unknown as UIMessageStreamWriter;
  return { chunks, writer };
}

describe("technician workflow", () => {
  it("distinguishes missing output from confirmed empty output", () => {
    const ctx = context([step("linux.net.dns_test")]);
    expect(decideNext(ctx.state).kind).toBe("request_output");
    ctx.state.steps[0].output = "";
    expect(decideNext(ctx.state)).toMatchObject({
      kind: "recommend",
      scriptId: "linux.net.flush_dns"
    });
    expect(
      matchesRule({ output_empty: true }, step("linux.net.dns_test"))
    ).toBe(false);
  });

  it("requires all branch conditions, and does not mistake 100% packet loss for success", () => {
    const failed = step("linux.net.ping_ip", "ran", "100% packet loss");
    expect(
      matchesRule({ output_matches: "100%", status: "failed" }, failed)
    ).toBe(false);
    expect(decideNext(context([failed]).state)).toMatchObject({
      kind: "recommend",
      scriptId: "linux.net.addr"
    });
  });

  it("preserves the last card so missing or unknown results can be clarified", () => {
    const ctx = context([step("linux.net.ping_ip", "pending")]);
    handleStepResult(ctx, ctx.state.steps[0].stepId, "worked");
    expect(ctx.state.steps[0]).toMatchObject({
      status: "ran",
      awaitingEvidence: true
    });
    expect(decideNext(ctx.state).kind).toBe("request_output");
    handleStepResult(
      ctx,
      ctx.state.steps[0].stepId,
      "ran",
      "4 packets transmitted, 4 received, 0% packet loss"
    );
    expect(decideNext(ctx.state)).toMatchObject({
      kind: "recommend",
      scriptId: "linux.net.dns_test"
    });
    expect(
      handleStepResult(ctx, ctx.state.steps[0].stepId, "worked").updated
    ).toBe(false);
  });

  it("does not issue a speculative repair for unrecognized results", () => {
    expect(
      decideNext(
        context([step("linux.net.dns_test", "ran", "mysterious output")]).state
      ).kind
    ).toBe("request_output");
  });

  it("completes diagnosis, repair, verification and the final artifact", async () => {
    const ctx = context([step("linux.net.dns_test", "ran", "")]);
    const { chunks, writer } = capture();
    await executeWorkflow(ctx, writer);
    expect(ctx.state.steps.at(-1)?.scriptId).toBe("linux.net.flush_dns");
    handleStepResult(ctx, ctx.state.steps.at(-1)!.stepId, "ran", "");
    await executeWorkflow(ctx, writer);
    expect(ctx.state.steps.at(-1)?.scriptId).toBe(
      "linux.net.dns_test_after_flush"
    );
    handleStepResult(
      ctx,
      ctx.state.steps.at(-1)!.stepId,
      "ran",
      "93.184.216.34 example.com"
    );
    await executeWorkflow(ctx, writer);
    expect(ctx.state.steps.at(-1)?.scriptId).toBe(
      "manual.linux.net.try_browse"
    );
    expect(ctx.state.phase).toBe("technician");
    handleStepResult(ctx, ctx.state.steps.at(-1)!.stepId, "worked");
    await executeWorkflow(ctx, writer);
    expect(ctx.state.phase).toBe("resolved");
    expect(ctx.state.finalArtifact?.markdown).toContain("What was verified");
    expect(ctx.state.finalArtifact?.markdown).toContain(
      "exact root cause was not independently established"
    );
    expect(
      chunks.filter((c) => c.type === "tool-output-available")
    ).toHaveLength(4);
  });

  it("rejects model-supplied success claims without user verification", async () => {
    const ctx = context([step("linux.net.flush_dns", "worked", "")]);
    const output = await buildTools(ctx).mark_resolved.execute!(
      {},
      { toolCallId: "test", messages: [], context: {} }
    );
    expect(output).toMatchObject({ ok: false });
    expect(ctx.state.phase).toBe("technician");
  });

  it("a completed manual repair still requires a separate original-task check", () => {
    expect(
      decideNext(context([step("manual.router_restart", "ran")]).state)
    ).toMatchObject({
      kind: "recommend",
      scriptId: "manual.linux.net.try_browse"
    });
  });

  it("failed verification continues with the supported next action", () => {
    const ctx = context([
      step("linux.net.flush_dns"),
      step("manual.linux.net.try_browse", "failed")
    ]);
    expect(decideNext(ctx.state)).toMatchObject({
      kind: "recommend",
      scriptId: "manual.router_restart"
    });
    expect(workflowState(ctx.state).failedFixes).toBe(1);
  });

  it("permits a fresh verification after a repair but stops identical repeats", () => {
    const before = step("manual.linux.net.try_browse", "failed");
    expect(
      decideNext(context([before, step("manual.router_restart")]).state)
    ).toMatchObject({ kind: "recommend", scriptId: before.scriptId });
    expect(
      decideNext(
        context([
          step("linux.net.ping_ip"),
          step("linux.net.route", "ran", "default via 192.168.1.1")
        ]).state
      ).kind
    ).toBe("escalate");
  });

  it("counts failed repair attempts once and emits a report at three", async () => {
    const ctx = context([
      step("linux.net.wifi_on", "failed"),
      step("linux.net.flush_dns", "failed"),
      step("linux.net.nm_restart", "failed"),
      step("manual.linux.net.try_browse", "failed")
    ]);
    expect(workflowState(ctx.state).failedFixes).toBe(3);
    await executeWorkflow(ctx, capture().writer);
    expect(ctx.state.phase).toBe("escalated");
    expect(ctx.state.finalArtifact?.markdown).toContain(
      "Three repair attempts"
    );
  });

  it("processes the twelfth step result before enforcing the limit", () => {
    const ctx = context(
      Array.from({ length: 11 }, () =>
        step("linux.net.radio", "ran", "enabled")
      )
    );
    ctx.state.steps.push(step("manual.linux.net.try_browse", "pending"));
    expect(decideNext(ctx.state).kind).toBe("wait");
    handleStepResult(ctx, ctx.state.steps.at(-1)!.stepId, "worked");
    expect(decideNext(ctx.state).kind).toBe("resolve");
    ctx.state.steps.at(-1)!.status = "failed";
    expect(decideNext(ctx.state).kind).toBe("escalate");
  });

  it("stops when the needed action is unavailable or requires absent admin access", () => {
    expect(
      decideNext(context([step("linux.net.ping_ip", "cant_run")]).state).kind
    ).toBe("escalate");
    const ctx = context([step("linux.net.dns_test", "ran", "")]);
    ctx.state.caseFile.canUseAdmin = false;
    expect(decideNext(ctx.state).kind).toBe("escalate");
  });

  it("keeps terminal sessions closed and their artifact available", async () => {
    const ctx = context([step("manual.linux.net.try_browse", "worked")]);
    await executeWorkflow(ctx, capture().writer);
    const tools = buildTools(ctx);
    expect(
      await tools.recommend_step.execute!(
        { scriptId: "linux.net.radio", whyNow: "again" },
        { toolCallId: "test", messages: [], context: {} }
      )
    ).toMatchObject({ ok: false });
    expect(
      handleStepResult(ctx, ctx.state.steps[0].stepId, "failed").updated
    ).toBe(false);
    const { chunks, writer } = capture();
    await executeWorkflow(ctx, writer);
    expect(chunks.some((c) => c.type === "tool-output-available")).toBe(true);
  });

  it("requires explicit original-task confirmation, not vague or contradictory chat", () => {
    const ctx = context([step("manual.linux.net.try_browse", "pending")]);
    expect(resultFromText(ctx, "Yes, it works.")?.status).toBe("worked");
    expect(
      resultFromText(ctx, "yes but other sites still fail")
    ).toBeUndefined();
    expect(resultFromText(ctx, "the command ran fine")).toBeUndefined();
  });

  it("shares evidence and terminal policy with backup mode", () => {
    for (const last of [
      step("linux.net.dns_test", "ran", ""),
      step("linux.net.ping_ip"),
      step("manual.linux.net.try_browse", "worked")
    ]) {
      const state = context([last]).state;
      const decision = decideNext(state);
      const reply = playbookReply({
        ...state,
        phase: "technician",
        degraded: true
      });
      if (decision.kind === "recommend")
        expect(reply.card?.scriptId).toBe(decision.scriptId);
      if (decision.kind === "request_output")
        expect(reply.text).toBe(decision.message);
      if (decision.kind === "resolve") expect(reply.resolved).toBe(true);
    }
  });
});
