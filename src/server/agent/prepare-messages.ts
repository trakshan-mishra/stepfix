import type { UIMessage } from "ai";
import type { CaseFile, Step, Phase } from "./case-file";
import {
  wrapUntrusted,
  truncateForUntrusted,
  stripLookalikeTags
} from "../guardrails/untrusted";
import { catalogFor } from "../library/index";
import { decideNext, workflowState } from "./workflow";
import technicianPromptText from "./prompts/technician.md?raw";
import supportPromptText from "./prompts/support.md?raw";

export function buildSystemPrompt(
  phase: Phase,
  caseFile: CaseFile,
  steps: Step[],
  catalogSubset: string
): string {
  const basePrompts: Record<Phase, string> = {
    support: supportPromptText,
    technician: technicianPromptText,
    resolved: "You are the stepfix agent. The problem has been resolved.",
    escalated:
      "Troubleshooting has ended. The user has a report to share; nobody has been notified.",
    closed: "You are the stepfix agent. This session is closed."
  };

  let prompt = basePrompts[phase];

  if (phase === "technician") {
    const caseJson = wrapUntrusted(JSON.stringify(caseFile, null, 2));
    const stepsTable =
      steps.length === 0
        ? "(none yet)"
        : steps
            .map(
              (s, i) =>
                `${i + 1}. ${s.scriptId} (${s.status})${s.awaitingEvidence ? " — needs more evidence" : ""}${s.output !== undefined ? `\nResult: ${wrapUntrusted(s.output)}` : " — output not supplied"}`
            )
            .join("\n");
    prompt = prompt
      .replace("{{CASE_JSON}}", caseJson)
      .replace("{{STEPS_TABLE}}", stepsTable)
      .replace("{{CATALOG_SUBSET}}", catalogSubset);
    prompt += `\nSERVER WORKFLOW\n${JSON.stringify(workflowState({ phase, caseFile, steps }))}\nALLOWED NEXT ACTION\n${JSON.stringify(decideNext({ phase, caseFile, steps }))}`;
  }

  if (phase === "support")
    prompt += `\nCASE RECORDED SO FAR\n${wrapUntrusted(JSON.stringify(caseFile))}`;

  return prompt;
}

export function formatCatalogSubset(os: string, category: string): string {
  const entries = catalogFor(os, category);
  if (entries.length === 0)
    return "(no scripts available for this OS/category)";
  return entries
    .map(
      (e) =>
        `- ${e.id} | ${e.title} | risk: ${e.risk} | admin: ${e.needs_admin} | ${e.when_to_use}`
    )
    .join("\n");
}

export function prepareMessagesForModel(
  messages: UIMessage[],
  steps: Step[],
  maxMessages: number = 12
): UIMessage[] {
  const recent = messages.slice(-maxMessages);

  for (const msg of recent) {
    for (const part of msg.parts) {
      if (part.type === "text") {
        const text = (part as { text: string }).text;
        if (text && text.length > 500) {
          (part as { text: string }).text = wrapUntrusted(
            truncateForUntrusted(stripLookalikeTags(text))
          );
        }
      }
    }
  }

  return recent;
}
