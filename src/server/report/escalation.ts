import type { CaseFile, Step, Phase } from "../agent/case-file";

interface EscalationParams {
  sessionId: string;
  caseFile: CaseFile;
  steps: Step[];
  reason: string;
  likelyCause?: string;
  phase: Phase;
}

export function buildEscalationReport(params: EscalationParams): string {
  const { sessionId, caseFile, steps, reason, likelyCause, phase } = params;
  const shortId = sessionId.slice(0, 8);
  const now = new Date().toISOString();

  const lines: string[] = [];
  lines.push(
    `# Support case ${shortId} — ${caseFile.category ?? "unknown"} on ${caseFile.os}${caseFile.osVersion ? " " + caseFile.osVersion : ""}`
  );
  lines.push(`**Status:** ${phase} · **Reason:** ${reason} · **When:** ${now}`);
  lines.push("");
  lines.push("## Problem");
  lines.push(caseFile.summary ?? caseFile.symptom ?? "No summary recorded.");
  lines.push("");

  if (caseFile.device || caseFile.whenStarted || caseFile.whatChanged) {
    const details: string[] = [];
    if (caseFile.device) details.push(`Device: ${caseFile.device}`);
    if (caseFile.whenStarted) details.push(`Started: ${caseFile.whenStarted}`);
    if (caseFile.whatChanged) details.push(`Changed: ${caseFile.whatChanged}`);
    lines.push(details.join(" · "));
    lines.push("");
  }

  if (caseFile.errorText) {
    lines.push(`Error text: \`${caseFile.errorText}\``);
    lines.push("");
  }

  lines.push("## What we tried");
  if (steps.length === 0) {
    lines.push("No steps were attempted.");
  } else {
    lines.push("| # | Step (library id @ version) | Result | Key output |");
    lines.push("|---|---|---|---|");
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const output = s.output
        ? s.output.slice(0, 100).replace(/\|/g, "\\|").replace(/\n/g, " ")
        : "";
      lines.push(
        `| ${i + 1} | ${s.scriptId}@${s.scriptVersion} | ${s.status} | ${output} |`
      );
    }
  }
  lines.push("");

  lines.push("## Likely cause");
  lines.push(likelyCause ?? "Unknown");
  lines.push("");

  lines.push("## Suggested next actions for a human");
  lines.push(
    "- Review the steps above and check for anything that wasn't tried."
  );
  lines.push(
    "- Consider hardware diagnostics, BIOS/firmware updates, or driver reinstallation."
  );
  lines.push("- If the user has admin access, try the steps that require it.");
  lines.push("");

  if (steps.some((s) => s.output)) {
    lines.push("<details><summary>Full outputs (secrets removed)</summary>");
    lines.push("");
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      if (s.output) {
        lines.push(`### Step ${i + 1}: ${s.scriptId}`);
        lines.push("```");
        lines.push(s.output);
        lines.push("```");
        lines.push("");
      }
    }
    lines.push("</details>");
  }

  return lines.join("\n");
}
