import type { CaseFile, Step, WorkflowState } from "./case-file";
import { catalogFor, getScript, getFlows } from "../library/index";
import type { CompiledEntry, NextCondition, NextRule } from "../library/schema";

export interface WorkflowContext {
  phase: string;
  caseFile: CaseFile;
  steps: Step[];
}

export type WorkflowDecision =
  | { kind: "select"; scriptIds: string[]; fallbackId?: string }
  | { kind: "wait"; message: string }
  | { kind: "request_output"; message: string; stepId: string }
  | { kind: "recommend"; scriptId: string; reason: string }
  | { kind: "resolve"; rootCause: string }
  | { kind: "escalate"; reason: string }
  | { kind: "terminal" };

export function purposeOf(script: CompiledEntry) {
  return script.purpose ?? (script.risk === "read_only" ? "diagnostic" : "fix");
}

export function matchesRule(when: NextCondition, step: Step): boolean {
  // Missing output is not evidence of an empty result. All supplied conditions
  // must hold, rather than treating a compound condition as an OR.
  if (when.status && step.status !== when.status) return false;
  if (
    when.output_empty &&
    (step.output === undefined || step.output.trim() !== "")
  )
    return false;
  if (when.output_matches) {
    if (step.output === undefined) return false;
    try {
      if (!new RegExp(when.output_matches, "im").test(step.output))
        return false;
    } catch {
      return false;
    }
  }
  return Object.keys(when).length > 0;
}

export function matchNextRule(
  rules: NextRule[],
  step: Step
): string | undefined {
  const rule = rules.find((r) => "when" in r && matchesRule(r.when, step));
  if (rule && "goto" in rule) return rule.goto;
  const fallback = rules.find((r) => "default" in r);
  return fallback && "default" in fallback ? fallback.default : undefined;
}

export function findingsFor(step: Step): string[] {
  if (step.output === undefined) return [];
  return (getScript(step.scriptId)?.expect ?? [])
    .filter((e) => {
      try {
        return new RegExp(e.pattern, "im").test(step.output!);
      } catch {
        return false;
      }
    })
    .map((e) => e.meaning);
}

export function workflowState(state: WorkflowContext): WorkflowState {
  let fix: Step | undefined;
  const failures = new Set<string>();
  for (const step of state.steps) {
    const script = getScript(step.scriptId);
    if (!script) continue;
    if (purposeOf(script) === "fix") {
      fix = step;
      if (step.status === "failed") failures.add(step.stepId);
    } else if (
      fix &&
      script.verifies_original_task &&
      step.status === "failed"
    ) {
      failures.add(fix.stepId);
    }
  }
  const last = state.steps.at(-1);
  const script = last && getScript(last.scriptId);
  const purpose = script && purposeOf(script);
  const stage =
    state.phase === "resolved" || state.phase === "escalated"
      ? state.phase
      : script?.verifies_original_task
        ? "confirm"
        : purpose === "verification"
          ? "verify"
          : purpose === "fix"
            ? "fix"
            : "diagnose";
  return {
    stage,
    failedFixes: failures.size,
    fixStepId: fix?.stepId,
    verificationStepId: script?.verifies_original_task
      ? last?.stepId
      : undefined,
    finding: last ? findingsFor(last).join(" ") || undefined : undefined
  };
}

function originalTaskCheck(state: WorkflowContext) {
  return catalogFor(state.caseFile.os, state.caseFile.category ?? "").find(
    (s) => s.verifies_original_task
  );
}

function entryFor(state: WorkflowContext) {
  const family = state.caseFile.os.startsWith("windows") ? "windows" : "linux";
  return getFlows().find(
    (f) => f.os_family === family && f.category === state.caseFile.category
  )?.entry;
}

export function decideNext(state: WorkflowContext): WorkflowDecision {
  if (["resolved", "escalated", "closed"].includes(state.phase))
    return { kind: "terminal" };
  const workflow = workflowState(state);
  const last = state.steps.at(-1);
  const script = last && getScript(last.scriptId);
  // A successful final check at the step limit still resolves.
  if (
    last?.status === "worked" &&
    script?.verifies_original_task &&
    !last.awaitingEvidence
  ) {
    const fix = state.steps.find((s) => s.stepId === workflow.fixStepId);
    return {
      kind: "resolve",
      rootCause: fix
        ? `The problem was confirmed fixed after “${getScript(fix.scriptId)?.title}”. The exact root cause was not independently established.`
        : "You confirmed the original task works again. No specific repair or root cause was established."
    };
  }
  if (last?.status === "pending")
    return {
      kind: "wait",
      message:
        "Follow the current card, then share what happened. I’ll use that result to choose the next step."
    };
  if (workflow.failedFixes >= 3 || state.steps.length >= 12) {
    return {
      kind: "escalate",
      reason:
        workflow.failedFixes >= 3
          ? "Three repair attempts have not restored the original task. Further changes need a closer look."
          : "We’ve reached twelve steps without confirming a fix. I’ll stop here and give you a report of the evidence."
    };
  }
  if (!last) {
    const scriptIds = catalogFor(
      state.caseFile.os,
      state.caseFile.category ?? ""
    )
      .filter((s) => purposeOf(s) === "diagnostic" && s.risk === "read_only")
      .map((s) => s.id);
    return { kind: "select", scriptIds, fallbackId: entryFor(state) };
  }
  if (!script)
    return {
      kind: "escalate",
      reason: "The previous step is no longer in the library."
    };
  if (last.status === "cant_run") {
    return {
      kind: "escalate",
      reason: `You couldn’t complete “${script.title}”. I don’t have a validated alternative for that check; the report records this limitation.`
    };
  }
  const findings = findingsFor(last);
  if (
    (script.kind === "command" &&
      purposeOf(script) !== "fix" &&
      (last.output === undefined || findings.length === 0)) ||
    last.awaitingEvidence
  ) {
    if ((last.clarificationAttempts ?? 0) >= 3)
      return {
        kind: "escalate",
        reason: `We couldn’t get an interpretable result from “${script.title}”. I’ll stop rather than guess at a repair.`
      };
    return {
      kind: "request_output",
      stepId: last.stepId,
      message:
        last.output === undefined
          ? `“${script.title}” is a check, so completing it alone doesn’t tell us what is wrong. Paste its output, or choose “It printed nothing” if it finished without output.`
          : `That output doesn’t match the expected results for “${script.title}”. Please paste the complete result, including any error. I won’t infer a diagnosis from it yet.`
    };
  }
  let target = matchNextRule(script.next, last);
  // Completion of a repair is never itself proof that the user's task works.
  if (target === "RESOLVED") target = originalTaskCheck(state)?.id;
  if (target === "FLOW_ENTRY") target = entryFor(state);
  if (!target || target === "ESCALATE")
    return {
      kind: "escalate",
      reason:
        `${findings.join(" ")} I don’t have a supported next step for this result.`.trim()
    };
  let next = getScript(target);
  // A repair must be followed by a check before another repair is attempted.
  if (purposeOf(script) === "fix" && next && purposeOf(next) === "fix") {
    next = originalTaskCheck(state);
  }
  if (
    !next ||
    !next.os.includes(state.caseFile.os) ||
    (next.category !== state.caseFile.category && next.category !== "system")
  )
    return {
      kind: "escalate",
      reason:
        "The next library step is not available for this problem and operating system."
    };
  const previous = state.steps.map((s) => s.scriptId).lastIndexOf(next.id);
  if (previous >= 0) {
    const changedSince = state.steps.slice(previous + 1).some((s) => {
      const entry = getScript(s.scriptId);
      return (
        entry &&
        purposeOf(entry) === "fix" &&
        ["ran", "worked"].includes(s.status)
      );
    });
    if (purposeOf(next) === "fix" || !changedSince)
      return {
        kind: "escalate",
        reason: `Repeating “${next.title}” without a new change would not add evidence. I’ll stop and summarize what we know.`
      };
  }
  if (next.needs_admin && state.caseFile.canUseAdmin === false)
    return {
      kind: "escalate",
      reason:
        "The next supported repair requires administrator access, which you don’t have. The report explains what an administrator needs to investigate."
    };
  const meaning =
    findings.join(" ") ||
    (last.status === "failed"
      ? "You reported that this step failed."
      : "You completed the step.");
  return {
    kind: "recommend",
    scriptId: next.id,
    reason: `${meaning} ${next.verifies_original_task ? "Now check whether the original problem is fixed." : next.when_to_use}`
  };
}

export function canRecommend(
  state: WorkflowContext,
  scriptId: string
): string | undefined {
  if (state.phase !== "technician")
    return "Steps are only available during active troubleshooting.";
  const decision = decideNext(state);
  if (decision.kind === "select" && decision.scriptIds.includes(scriptId))
    return;
  if (decision.kind === "recommend" && decision.scriptId === scriptId) return;
  return decision.kind === "wait"
    ? "A step is already pending. Wait for its result."
    : decision.kind === "request_output"
      ? decision.message
      : "This step is not supported by the current evidence or session state.";
}
