import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import {
  runLoadTest,
  runReservationLoadTest,
  formatReport
} from "./load-runner";

async function main() {
  const args = process.argv.slice(2);
  const phase = args[0] ?? "progressive";

  const reports: string[] = [];
  reports.push(`# Load test report — ${new Date().toISOString()}`);
  reports.push("");
  reports.push("Mock quotas only — no live provider calls.");
  reports.push("");

  if (phase === "progressive" || phase === "all") {
    for (const n of [5, 10, 20]) {
      const result = runLoadTest({ sessions: n, maxActive: n, burst: false });
      reports.push(formatReport(result, `Progressive ${n} sessions`));
      reports.push("");
      console.log(
        `  ${n} sessions: admitted=${result.admitted} p50=${result.p50LatencyMs.toFixed(2)}ms p95=${result.p95LatencyMs.toFixed(2)}ms`
      );
    }
  }

  if (phase === "burst" || phase === "all") {
    const result = runLoadTest({ sessions: 50, maxActive: 20, burst: true });
    reports.push(formatReport(result, "Burst 50 (cap 20)"));
    reports.push("");
    console.log(
      `  burst 50: admitted=${result.admitted} queued=${result.queued} rejected=${result.rejected} p95=${result.p95LatencyMs.toFixed(2)}ms`
    );
  }

  if (phase === "reservation" || phase === "all") {
    const result = runReservationLoadTest(100, 30);
    reports.push(
      formatReport(result, "Reservation load (100 requests, limit 30)")
    );
    reports.push("");
    console.log(
      `  reservations: granted=${result.granted} denied=${result.denied} p95=${result.p95LatencyMs.toFixed(2)}ms`
    );
  }

  if (phase === "latency" || phase === "all") {
    for (const n of [100, 300]) {
      const result = runLoadTest({ sessions: n, maxActive: n, burst: false });
      reports.push(formatReport(result, `Synthetic ${n} sessions`));
      reports.push("");
      console.log(
        `  ${n} synthetic: p50=${result.p50LatencyMs.toFixed(2)}ms p95=${result.p95LatencyMs.toFixed(2)}ms`
      );
    }
  }

  const reportsDir = new URL("../load/reports/", import.meta.url);
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
  const date = new Date().toISOString().split("T")[0];
  const reportPath = new URL(`${date}.md`, reportsDir).pathname;
  writeFileSync(reportPath, reports.join("\n"));
  console.log(`Report written to ${reportPath}`);
}

main().catch(console.error);
