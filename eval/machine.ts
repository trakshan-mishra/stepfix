export interface MachineState {
  fixedScripts: Set<string>;
  afterFixOutputs: Record<string, string>;
  beforeOutputs: Record<string, string>;
  manualBefore: string;
  manualAfter: string;
}

export interface MachineResult {
  output: string;
  isFixed: boolean;
}

export function createMachine(
  beforeOutputs: Record<string, string>,
  afterFixOutputs: Record<string, string>,
  fixedBy: string[],
  manualBefore: string = "I completed the manual step.",
  manualAfter: string = "The manual step worked."
): MachineState {
  return {
    fixedScripts: new Set<string>(),
    afterFixOutputs,
    beforeOutputs,
    manualBefore,
    manualAfter
  };
}

export function executeCommand(
  machine: MachineState,
  scriptId: string,
  fixedBy: string[]
): MachineResult {
  if (machine.fixedScripts.size === fixedBy.length && fixedBy.length > 0) {
    const afterOutput = machine.afterFixOutputs[scriptId];
    if (afterOutput !== undefined) {
      return { output: afterOutput, isFixed: true };
    }
  }

  const beforeOutput = machine.beforeOutputs[scriptId];
  if (beforeOutput !== undefined) {
    return { output: beforeOutput, isFixed: false };
  }

  if (scriptId in machine.afterFixOutputs) {
    return { output: machine.afterFixOutputs[scriptId], isFixed: true };
  }

  return { output: "OK", isFixed: false };
}

export function markFixed(machine: MachineState, scriptId: string): void {
  machine.fixedScripts.add(scriptId);
}

export function isFullyFixed(
  machine: MachineState,
  fixedBy: string[]
): boolean {
  if (fixedBy.length === 0) return false;
  return fixedBy.every((s) => machine.fixedScripts.has(s));
}

export function getManualResult(
  machine: MachineState,
  isFixed: boolean
): string {
  return isFixed ? machine.manualAfter : machine.manualBefore;
}
