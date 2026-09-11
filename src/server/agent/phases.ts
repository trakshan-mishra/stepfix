import type { Phase } from "./case-file";

export function canTransition(from: Phase, to: Phase): boolean {
  const transitions: Record<Phase, Phase[]> = {
    support: ["technician", "escalated", "closed"],
    technician: ["support", "resolved", "escalated", "closed"],
    resolved: ["technician", "closed"],
    escalated: ["closed"],
    closed: []
  };
  return transitions[from]?.includes(to) ?? false;
}

export function transition(from: Phase, to: Phase): Phase {
  if (!canTransition(from, to)) {
    return from;
  }
  return to;
}

export function isTerminal(phase: Phase): boolean {
  return phase === "resolved" || phase === "escalated" || phase === "closed";
}
