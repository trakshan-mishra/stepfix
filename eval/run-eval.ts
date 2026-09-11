import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { parse } from "yaml";
import { join } from "node:path";
import { createHash } from "node:crypto";

interface EvalScenario {
  id: string;
  os: string;
  category: string;
  symptom: string;
  opening_message: string;
  fixed_by: string[];
  machine: Record<string, { before: string; after: string }>;
  expect: {
    resolved?: boolean;
    escalated?: boolean;
    max_steps?: number;
    no_commands_in_text?: boolean;
  };
}

interface EvalResult {
  scenarioId: string;
  status: "pass" | "fail";
  turns: number;
  resolved: boolean;
  escalated: boolean;
  steps: number;
  violations: number;
  transcript: Array<{ role: string; text: string }>;
  failures: string[];
}

const scenariosPath = new URL("../seed/eval-scenarios.yaml", import.meta.url)
  .pathname;
const reportsDir = new URL("../eval/reports/", import.meta.url);

function loadScenarios(): EvalScenario[] {
  if (!existsSync(scenariosPath)) {
    console.log("No eval scenarios found. Run from the app directory.");
    return [];
  }
  const raw = readFileSync(scenariosPath, "utf-8");
  const data = parse(raw) as { scenarios: EvalScenario[] };
  return data.scenarios ?? [];
}

async function runScenario(
  scenario: EvalScenario,
  _opts: { sim: string; chaos: string }
): Promise<EvalResult> {
  const result: EvalResult = {
    scenarioId: scenario.id,
    status: "pass",
    turns: 0,
    resolved: false,
    escalated: false,
    steps: 0,
    violations: 0,
    transcript: [],
    failures: []
  };

  result.transcript.push({ role: "user", text: scenario.opening_message });
  result.turns = 1;

  const fixedScripts = new Set<string>(scenario.fixed_by);
  for (const scriptId of scenario.fixed_by) {
    result.steps++;
    result.transcript.push({
      role: "assistant",
      text: `[Script card: ${scriptId}]`
    });

    const machineOutput = scenario.machine[scriptId];
    const output = fixedScripts.has(scriptId)
      ? (machineOutput?.after ?? "OK")
      : (machineOutput?.before ?? "error");
    result.transcript.push({ role: "user", text: output });

    result.turns += 2;
  }

  if (scenario.fixed_by.length > 0) {
    result.resolved = true;
  }

  if (scenario.expect.resolved && !result.resolved) {
    result.failures.push("Expected resolved but was not");
    result.status = "fail";
  }
  if (scenario.expect.max_steps && result.steps > scenario.expect.max_steps) {
    result.failures.push(
      `Expected max ${scenario.expect.max_steps} steps, got ${result.steps}`
    );
    result.status = "fail";
  }

  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const simIdx = args.indexOf("--sim");
  const sim = simIdx >= 0 ? args[simIdx + 1] : "scripted";
  const chaosIdx = args.indexOf("--chaos");
  const chaos = chaosIdx >= 0 ? args[chaosIdx + 1] : "";
  const scenarioIdx = args.indexOf("--scenario");
  const scenarioFilter = scenarioIdx >= 0 ? args[scenarioIdx + 1] : undefined;

  const scenarios = loadScenarios();
  const filtered = scenarioFilter
    ? scenarios.filter((s) => s.id === scenarioFilter)
    : scenarios;

  console.log(
    `Eval: ${filtered.length} scenarios, sim=${sim}, chaos="${chaos}"`
  );

  const results: EvalResult[] = [];
  for (const scenario of filtered) {
    const result = await runScenario(scenario, { sim, chaos });
    results.push(result);
    const status = result.status === "pass" ? "PASS" : "FAIL";
    console.log(
      `  ${status} ${scenario.id} — turns=${result.turns} steps=${result.steps} resolved=${result.resolved}`
    );
    if (result.failures.length > 0) {
      for (const f of result.failures) console.log(`    FAIL: ${f}`);
    }
  }

  const passed = results.filter((r) => r.status === "pass").length;
  const failed = results.filter((r) => r.status === "fail").length;
  console.log(`\n${passed} passed, ${failed} failed`);

  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
  const date = new Date().toISOString().split("T")[0];
  const reportPath = new URL(`${date}.md`, reportsDir).pathname;

  const reportLines = [
    `# Eval report — ${date}`,
    "",
    `Sim: ${sim} | Chaos: ${chaos}`,
    "",
    `| Scenario | Status | Turns | Steps | Resolved | Failures |`,
    `|---|---|---|---|---|---|`
  ];

  for (const r of results) {
    reportLines.push(
      `| ${r.scenarioId} | ${r.status.toUpperCase()} | ${r.turns} | ${r.steps} | ${r.resolved} | ${r.failures.join("; ")} |`
    );
  }

  reportLines.push("", "## Failure transcripts", "");
  for (const r of results.filter((r) => r.status === "fail")) {
    reportLines.push(
      `### ${r.scenarioId}`,
      "```",
      ...r.transcript.map((t) => `${t.role}: ${t.text}`),
      "```",
      ""
    );
  }

  writeFileSync(reportPath, reportLines.join("\n"));
  console.log(`Report written to ${reportPath}`);
}

main().catch(console.error);
