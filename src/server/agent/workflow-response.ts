import { nanoid } from "nanoid";
import type { UIMessageStreamWriter } from "ai";
import { buildTools, type ToolContext } from "./tools";
import { decideNext, purposeOf, type WorkflowDecision } from "./workflow";
import { getScript } from "../library/index";

export function writeText(writer: UIMessageStreamWriter, text: string) {
  const id = nanoid(12);
  writer.write({ type: "text-start", id });
  writer.write({ type: "text-delta", id, delta: text });
  writer.write({ type: "text-end", id });
}

// Deterministic actions use the same validated tools and UI parts as model
// actions, including persistence of cards and terminal artifacts.
export async function executeWorkflow(
  ctx: ToolContext,
  writer: UIMessageStreamWriter,
  decision: WorkflowDecision = decideNext(ctx.state)
): Promise<void> {
  if (decision.kind === "terminal") {
    writeText(
      writer,
      ctx.state.phase === "resolved"
        ? "This case is resolved. Your fix summary is below."
        : "Troubleshooting has ended. You can share the report below with someone who can help."
    );
    const artifact = ctx.state.finalArtifact;
    if (artifact)
      writeToolResult(
        writer,
        artifact.kind === "resolved" ? "mark_resolved" : "escalate_to_human",
        {},
        artifact.kind === "resolved"
          ? { ok: true, summary: artifact.markdown }
          : { ok: true, markdown: artifact.markdown, notified: false }
      );
    return;
  }
  if (decision.kind === "wait" || decision.kind === "request_output") {
    writeText(writer, decision.message);
    return;
  }
  const tools = buildTools(ctx);
  if (decision.kind === "select") {
    if (
      !decision.fallbackId ||
      !decision.scriptIds.includes(decision.fallbackId)
    ) {
      return executeWorkflow(ctx, writer, {
        kind: "escalate",
        reason: "There isn’t a supported first check for this case."
      });
    }
    decision = {
      kind: "recommend",
      scriptId: decision.fallbackId,
      reason: "Let’s start with a read-only check to narrow down the cause."
    };
  }
  if (decision.kind === "recommend") {
    const script = getScript(decision.scriptId);
    const previous = [...ctx.state.steps]
      .reverse()
      .find((s) => s.scriptId === decision.scriptId);
    const params = previous?.params ?? {};
    if (
      script?.params &&
      Object.keys(script.params).some((key) => !params[key])
    ) {
      writeText(
        writer,
        `Before “${script.title}”, I need ${Object.entries(script.params)
          .filter(([key]) => !params[key])
          .map(([, param]) => param.description ?? "the required setting")
          .join(" and ")}. Please tell me; I won’t guess.`
      );
      return;
    }
    const input = {
      scriptId: decision.scriptId,
      params,
      whyNow: decision.reason.slice(0, 300)
    };
    const output = await tools.recommend_step.execute!(input, {
      toolCallId: nanoid(),
      messages: [],
      context: {}
    });
    if (!("ok" in output) || !output.ok) {
      writeText(
        writer,
        "I can’t safely issue that step with the current information. Please describe any error or ask for a report."
      );
      return;
    }
    writeText(writer, decision.reason);
    writeToolResult(writer, "recommend_step", input, output);
    return;
  }
  if (decision.kind === "resolve") {
    const output = await tools.mark_resolved.execute!(
      {},
      { toolCallId: nanoid(), messages: [], context: {} }
    );
    writeText(
      writer,
      "You confirmed the original problem is fixed. Here’s a summary of what we tried and what was verified."
    );
    writeToolResult(writer, "mark_resolved", {}, output);
    return;
  }
  const input = { reason: decision.reason.slice(0, 300) };
  const output = await tools.escalate_to_human.execute!(input, {
    toolCallId: nanoid(),
    messages: [],
    context: {}
  });
  writeText(
    writer,
    `${decision.reason} Here’s the report you can copy or download. Nobody has been contacted automatically.`
  );
  writeToolResult(writer, "escalate_to_human", input, output);
}

function writeToolResult(
  writer: UIMessageStreamWriter,
  toolName: string,
  input: unknown,
  output: unknown
) {
  const toolCallId = nanoid(12);
  writer.write({ type: "tool-input-available", toolCallId, toolName, input });
  writer.write({ type: "tool-output-available", toolCallId, output });
}

// Plain-text confirmation is deliberately narrow. General chat remains with
// the model; it cannot manufacture a result on behalf of the user.
export function resultFromText(ctx: ToolContext, text: string) {
  const last = ctx.state.steps.at(-1);
  if (!last || (last.status !== "pending" && !last.awaitingEvidence)) return;
  const script = getScript(last.scriptId);
  if (!script) return;
  const reply = text
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/, "");
  if (script.verifies_original_task) {
    if (
      /^(yes|yes,? (it works|it is fixed|the problem is fixed)|it works now|it’s fixed|it's fixed|websites load now)$/.test(
        reply
      )
    )
      return { stepId: last.stepId, status: "worked" as const };
    if (
      /^(no|no,? (it still doesn.t work|it is still broken)|still broken|still not working)$/.test(
        reply
      )
    )
      return { stepId: last.stepId, status: "failed" as const };
  }
  if (/^(i can.t run (it|this)|no admin (rights|access))$/.test(reply))
    return { stepId: last.stepId, status: "cant_run" as const };
  if (
    script.kind === "command" &&
    /^(no output|nothing printed|it printed nothing)$/.test(reply)
  )
    return { stepId: last.stepId, status: "ran" as const, output: "" };
  if (purposeOf(script) === "fix" && /^(done|i ran it|completed)$/.test(reply))
    return { stepId: last.stepId, status: "ran" as const };
  if (
    script.kind === "command" &&
    !text.includes("?") &&
    (text.includes("\n") ||
      script.expect.some((expected) => {
        try {
          return new RegExp(expected.pattern, "im").test(text);
        } catch {
          return false;
        }
      }))
  )
    return {
      stepId: last.stepId,
      status: "ran" as const,
      output: text.slice(0, 8000)
    };
  return;
}
