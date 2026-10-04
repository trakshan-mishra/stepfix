// One assistant reply per turn: the tool loop ends once a step has written
// text. The exception is a successful handoff, where the technician carries on
// in the same turn so the user isn't left waiting.
export function endsTurn(step: {
  text: string;
  toolResults: Array<{ toolName: string; output: unknown }>;
}): boolean {
  const handedOff = step.toolResults.some(
    (r) =>
      r.toolName === "handoff_to_technician" &&
      (r.output as { ok?: boolean } | undefined)?.ok === true
  );
  return step.text.trim().length > 0 && !handedOff;
}
