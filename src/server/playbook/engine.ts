import type { Step, CaseFile, Phase } from "../agent/case-file";
import { getScript, getFlows } from "../library/index";
import { buildEscalationReport } from "../report/escalation";
import { nanoid } from "nanoid";

const SPECIAL_TARGETS = new Set(["RESOLVED", "ESCALATE", "FLOW_ENTRY"]);
void SPECIAL_TARGETS;

export interface PlaybookResult {
  text: string;
  card?: CardOutput;
  escalate?: { reportId: string; markdown: string };
  resolved?: boolean;
}

export interface CardOutput {
  stepId: string;
  scriptId: string;
  title: string;
  command?: string;
  manualSteps?: string[];
  explanation: string;
  risk: string;
  needsAdmin: boolean;
  kind: string;
  expect: Array<{ pattern: string; meaning: string }>;
  undo?: string;
  whyNow: string;
}

export interface PlaybookState {
  phase: Phase;
  caseFile: CaseFile;
  steps: Step[];
  degraded: boolean;
}

const INTRO_MESSAGE =
  "I'm in backup mode right now, so my replies are simpler, but we can keep going.";

export function playbookReply(
  state: PlaybookState,
  _lastResult?: { stepId?: string; status?: string; output?: string }
): PlaybookResult {
  if (state.phase === "support") {
    return supportPhaseReply(state);
  }

  if (state.phase !== "technician") {
    return { text: "This session has ended." };
  }

  const flows = getFlows();
  const osFamily = getOsFamily(state.caseFile.os);
  const category = state.caseFile.category ?? "bluetooth";

  const flow = flows.find(
    (f) => f.os_family === osFamily && f.category === category
  );
  if (!flow) {
    return escalateReply(state, "Backup mode can't handle this category.");
  }

  if (state.steps.length === 0) {
    return cardReply(state, flow.entry, INTRO_MESSAGE);
  }

  const lastStep = state.steps[state.steps.length - 1];

  if (lastStep.status === "pending") {
    return { text: "Run the step above and tell me what happened." };
  }

  const script = getScript(lastStep.scriptId);
  if (!script) {
    return escalateReply(state, "The last script is no longer available.");
  }

  let target: string | undefined;

  for (const rule of script.next) {
    if ("when" in rule) {
      if (matchesRule(rule.when, lastStep)) {
        target = rule.goto;
        break;
      }
    } else {
      target = rule.default;
    }
  }

  if (!target) {
    const defaultRule = script.next.find((r) => "default" in r);
    if (defaultRule && "default" in defaultRule) target = defaultRule.default;
  }

  if (!target) {
    return escalateReply(state, "No next step found in backup mode.");
  }

  if (target === "RESOLVED") {
    return {
      text: "Based on the results, it looks like the problem is fixed. Can you confirm?",
      resolved: true
    };
  }

  if (target === "ESCALATE") {
    return escalateReply(
      state,
      "I can't go further in backup mode. Here's a report you can send to a person."
    );
  }

  if (target === "FLOW_ENTRY") {
    return cardReply(state, flow.entry, INTRO_MESSAGE);
  }

  const triedCount = state.steps.filter((s) => s.scriptId === target).length;
  if (triedCount >= 2) {
    return escalateReply(
      state,
      "I've tried this step twice in backup mode without success."
    );
  }

  return cardReply(state, target, state.degraded ? undefined : INTRO_MESSAGE);
}

function supportPhaseReply(state: PlaybookState): PlaybookResult {
  const cf = state.caseFile;
  if (cf.os === "unknown" || !cf.category || !cf.symptom) {
    return {
      text:
        "I'm in backup mode right now. To help you, I need to know:\n" +
        "1. Are you on Windows or Linux (Ubuntu/Debian)?\n" +
        "2. What's the problem? (Bluetooth, Wi-Fi, or a command-line tool)\n" +
        "3. What happens when you try? (error message, or when it started)"
    };
  }

  return {
    text: `Thanks! I have your case: ${cf.os}, ${cf.category}, ${cf.symptom}. Let me check what we can do.`
  };
}

function cardReply(
  state: PlaybookState,
  scriptId: string,
  intro?: string
): PlaybookResult {
  const script = getScript(scriptId);
  if (!script) {
    return escalateReply(state, `Script ${scriptId} not found in the library.`);
  }

  const stepId = nanoid(12);
  const card: CardOutput = {
    stepId,
    scriptId: script.id,
    title: script.title,
    command: script.kind === "command" ? script.command : undefined,
    manualSteps: script.manual_steps,
    explanation: script.explanation,
    risk: script.risk,
    needsAdmin: script.needs_admin,
    kind: script.kind,
    expect: script.expect,
    undo: script.undo ?? undefined,
    whyNow: script.when_to_use
  };

  const text = intro
    ? `${intro}\n\nLet's try: ${script.title}`
    : `Let's try: ${script.title}`;

  return { text, card };
}

function escalateReply(state: PlaybookState, reason: string): PlaybookResult {
  const report = buildEscalationReport({
    sessionId: "backup-mode",
    caseFile: state.caseFile,
    steps: state.steps,
    reason,
    phase: "escalated"
  });
  return {
    text: reason,
    escalate: { reportId: nanoid(12), markdown: report }
  };
}

function matchesRule(
  when: { output_matches?: string; output_empty?: boolean; status?: string },
  step: Step
): boolean {
  if (when.status && step.status === when.status) return true;
  if (when.output_empty && (!step.output || step.output.trim() === ""))
    return true;
  if (when.output_matches && step.output) {
    try {
      const re = new RegExp(when.output_matches, "im");
      if (re.test(step.output)) return true;
    } catch {
      // invalid regex
    }
  }
  return false;
}

function getOsFamily(os: string): string {
  if (os === "ubuntu" || os === "debian" || os === "linux_other")
    return "linux";
  if (os === "windows11" || os === "windows10") return "windows";
  return "linux";
}
