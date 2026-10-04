import type { CaseFile, Step } from "../agent/case-file";
import { getScript } from "../library/index";

const RESULT_LABELS: Record<string, string> = {
  pending: "not run",
  ran: "ran",
  worked: "worked",
  failed: "didn't work",
  cant_run: "couldn't run"
};

interface SummaryParams {
  caseFile: CaseFile;
  steps: Step[];
  rootCause: string;
}

// A short record the person can keep after a fix: what was wrong, what was
// tried, and what fixed it.
export function buildResolutionSummary(params: SummaryParams): string {
  const { caseFile, steps, rootCause } = params;
  const lines: string[] = [];

  lines.push(
    `# stepfix summary: ${caseFile.category ?? "problem"} on ${caseFile.os}`
  );
  lines.push("");
  lines.push("## The problem");
  lines.push(caseFile.summary ?? caseFile.symptom ?? "No summary recorded.");
  if (caseFile.whenStarted) lines.push(`Started: ${caseFile.whenStarted}`);
  lines.push("");

  lines.push("## What we tried");
  if (steps.length === 0) {
    lines.push("No steps were needed.");
  } else {
    steps.forEach((step, i) => {
      const title = getScript(step.scriptId)?.title ?? step.scriptId;
      lines.push(
        `${i + 1}. ${title}: ${RESULT_LABELS[step.status] ?? step.status}`
      );
    });
  }
  lines.push("");

  lines.push("## What fixed it");
  lines.push(rootCause);
  lines.push("");

  return lines.join("\n");
}
