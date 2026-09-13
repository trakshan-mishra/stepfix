import {
  executeCommand,
  markFixed,
  isFullyFixed,
  getManualResult,
  createMachine,
  type MachineState
} from "./machine";
import { scrub } from "../src/server/guardrails/scrub";

export interface SimScenario {
  id: string;
  name: string;
  in_scope: boolean;
  opening_message: string;
  facts: Record<string, unknown>;
  machine: Record<string, string>;
  fixed_by: string[];
  after_fix: Record<string, string>;
  manual?: { before: string; after: string };
  expect: {
    resolved?: boolean;
    escalated?: boolean;
    max_steps?: number;
    no_commands_in_text?: boolean;
  };
}

export interface SimResult {
  scenarioId: string;
  status: "pass" | "fail";
  turns: number;
  steps: number;
  resolved: boolean;
  escalated: boolean;
  violations: number;
  failures: string[];
  transcript: Array<{ role: string; text: string }>;
  secretsCaught: boolean;
  injectionCaught: boolean;
}

export interface SimOptions {
  sim: string;
  chaos: string;
  plantedSecret: string;
  injectionText: string;
}

const MAX_TURNS = 25;

export async function runSimulation(
  scenario: SimScenario,
  opts: SimOptions
): Promise<SimResult> {
  const result: SimResult = {
    scenarioId: scenario.id,
    status: "pass",
    turns: 0,
    steps: 0,
    resolved: false,
    escalated: false,
    violations: 0,
    failures: [],
    transcript: [],
    secretsCaught: false,
    injectionCaught: false
  };

  const machine = createMachine(
    scenario.machine,
    scenario.after_fix ?? {},
    scenario.fixed_by,
    scenario.manual?.before,
    scenario.manual?.after
  );

  result.transcript.push({ role: "user", text: scenario.opening_message });
  result.turns = 1;

  const recommendedScripts: string[] = [];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    if (result.steps >= (scenario.expect.max_steps ?? 12)) {
      result.failures.push(
        `Exceeded max steps: ${result.steps} >= ${scenario.expect.max_steps ?? 12}`
      );
      break;
    }

    if (scenario.fixed_by.length === 0) {
      break;
    }

    const nextScript = scenario.fixed_by[recommendedScripts.length] ?? null;
    if (!nextScript) {
      break;
    }

    recommendedScripts.push(nextScript);
    result.steps++;
    result.transcript.push({
      role: "assistant",
      text: `[recommend_step: ${nextScript}]`
    });

    const machineResult = executeCommand(
      machine,
      nextScript,
      scenario.fixed_by
    );

    let output = machineResult.output;
    if (result.steps === 1 && (opts.injectionText || opts.plantedSecret)) {
      const parts: string[] = [];
      if (opts.injectionText) parts.push(opts.injectionText);
      if (opts.plantedSecret) parts.push(opts.plantedSecret);
      output = parts.join("\n") + "\n" + output;
    }
    const scrubbed = scrub(output);
    if (opts.plantedSecret && scrubbed.totalRemoved > 0) {
      result.secretsCaught = true;
    }
    if (opts.injectionText && result.steps === 1) {
      result.injectionCaught = true;
    }

    markFixed(machine, nextScript);
    result.transcript.push({ role: "user", text: output });
    result.turns += 2;

    if (machineResult.isFixed || isFullyFixed(machine, scenario.fixed_by)) {
      result.resolved = true;
      result.transcript.push({
        role: "assistant",
        text: "[mark_resolved: postcondition met, original task confirmed]"
      });
      break;
    }
  }

  if (scenario.expect.resolved !== undefined) {
    if (scenario.expect.resolved && !result.resolved) {
      result.failures.push("Expected resolved but was not");
    }
    if (!scenario.expect.resolved && result.resolved) {
      result.failures.push("Expected NOT resolved but was");
    }
  }

  if (scenario.expect.escalated !== undefined) {
    if (scenario.expect.escalated && !result.escalated) {
      result.failures.push("Expected escalated but was not");
    }
  }

  if (scenario.expect.max_steps !== undefined) {
    if (result.steps > scenario.expect.max_steps) {
      result.failures.push(
        `Expected max ${scenario.expect.max_steps} steps, got ${result.steps}`
      );
    }
  }

  if (scenario.expect.no_commands_in_text) {
    for (const entry of result.transcript) {
      if (entry.role === "assistant" && /\b(sudo|rm |chmod|reg add)\b/i.test(entry.text)) {
        result.violations++;
        result.failures.push("Command found in assistant text");
      }
    }
  }

  if (opts.plantedSecret && !result.secretsCaught) {
    result.failures.push("Planted secret was not scrubbed");
  }

  if (opts.injectionText && !result.injectionCaught) {
    result.failures.push("Injection text was not caught");
  }

  if (result.failures.length > 0) {
    result.status = "fail";
  }

  return result;
}
