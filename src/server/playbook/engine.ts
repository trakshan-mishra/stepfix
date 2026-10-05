import type { Step, CaseFile, Phase, Card } from "../agent/case-file";
import { getScript, renderCommand } from "../library/index";
import { buildEscalationReport } from "../report/escalation";
import { decideNext, purposeOf } from "../agent/workflow";
import { nanoid } from "nanoid";

export interface PlaybookResult {
  text: string;
  card?: Card;
  escalate?: { reportId: string; markdown: string };
  resolved?: boolean;
}
export type CardOutput = Card;
export interface PlaybookState {
  phase: Phase;
  caseFile: CaseFile;
  steps: Step[];
  degraded: boolean;
}

// Both modes use exactly the same evidence, loop and resolution policy.
export function playbookReply(state: PlaybookState): PlaybookResult {
  if (state.phase === "support") {
    return {
      text: "I'm in backup mode right now. Please tell me your operating system, what is broken, and when it started or what changed. Your existing case details are saved."
    };
  }
  const decision = decideNext(state);
  if (decision.kind === "terminal") return { text: "This session has ended." };
  if (decision.kind === "wait" || decision.kind === "request_output")
    return { text: decision.message };
  if (decision.kind === "resolve")
    return {
      text: "You confirmed the original task works again. Your fix summary is ready.",
      resolved: true
    };
  if (decision.kind === "escalate")
    return escalateReply(state, decision.reason);
  const scriptId =
    decision.kind === "select" ? decision.fallbackId : decision.scriptId;
  const script = scriptId && getScript(scriptId);
  if (!script)
    return escalateReply(state, "No supported next check is available.");
  const params =
    [...state.steps].reverse().find((s) => s.scriptId === script.id)?.params ??
    {};
  const rendered =
    script.kind === "manual"
      ? { ok: true as const, command: undefined }
      : renderCommand(script, params);
  if (!rendered.ok)
    return {
      text: "I need the required settings for this step before I can show its card. Please describe the tool or setting involved."
    };
  return {
    text:
      decision.kind === "recommend"
        ? decision.reason
        : "I'm in backup mode. Let's start with a read-only check.",
    card: {
      stepId: nanoid(12),
      scriptId: script.id,
      version: script.version,
      hash: script.hash,
      title: script.title,
      os: script.os.join(", "),
      shell: script.shell,
      kind: script.kind,
      command: rendered.command,
      manualSteps: script.manual_steps,
      explanation: script.explanation,
      expect: script.expect,
      risk: script.risk,
      needsAdmin: script.needs_admin,
      purpose: purposeOf(script),
      verifiesOriginalTask: script.verifies_original_task,
      undo: script.undo ?? undefined,
      sources: script.sources,
      whyNow: script.when_to_use
    }
  };
}

function escalateReply(state: PlaybookState, reason: string): PlaybookResult {
  return {
    text: reason,
    escalate: {
      reportId: nanoid(12),
      markdown: buildEscalationReport({
        sessionId: "backup-mode",
        caseFile: state.caseFile,
        steps: state.steps,
        reason,
        phase: "escalated"
      })
    }
  };
}
