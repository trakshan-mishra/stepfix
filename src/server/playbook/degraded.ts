import type { Phase, CaseFile, Step } from "../agent/case-file";

export interface DegradedSnapshot {
  phase: Phase;
  caseFile: CaseFile;
  steps: Step[];
  pendingActionId?: string;
  caseVersion: number;
  degradedAt: number;
}

export function captureSnapshot(
  phase: Phase,
  caseFile: CaseFile,
  steps: Step[],
  caseVersion: number,
  now: number = Date.now()
): DegradedSnapshot {
  return {
    phase,
    caseFile: { ...caseFile, facts: [...caseFile.facts] },
    steps: steps.map((s) => ({ ...s })),
    caseVersion,
    degradedAt: now
  };
}

export function restoreFromSnapshot(
  snapshot: DegradedSnapshot
): {
  phase: Phase;
  caseFile: CaseFile;
  steps: Step[];
  caseVersion: number;
} {
  return {
    phase: snapshot.phase,
    caseFile: snapshot.caseFile,
    steps: snapshot.steps,
    caseVersion: snapshot.caseVersion
  };
}

export function isRestorable(snapshot: DegradedSnapshot | undefined): boolean {
  if (!snapshot) return false;
  return snapshot.caseVersion > 0;
}
