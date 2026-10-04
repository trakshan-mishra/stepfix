import { describe, expect, it } from "vitest";
import { buildResolutionSummary } from "../src/server/report/summary";
import { getAllScripts } from "../src/server/library/index";
import type { CaseFile, Step } from "../src/server/agent/case-file";

describe("buildResolutionSummary", () => {
  it("lists the problem, each step by its title and result, and the fix", () => {
    const [first, second] = getAllScripts();
    const step = (scriptId: string, status: Step["status"]): Step => ({
      stepId: scriptId,
      scriptId,
      scriptVersion: 1,
      params: {},
      whyNow: "",
      status,
      matchedPatterns: [],
      createdAt: 0,
      updatedAt: 0,
      source: "llm"
    });

    const summary = buildResolutionSummary({
      caseFile: {
        os: "ubuntu",
        category: "wifi",
        summary: "Connected to Wi-Fi but pages don't load.",
        whenStarted: "after yesterday's update"
      } as CaseFile,
      steps: [step(first.id, "failed"), step(second.id, "worked")],
      rootCause:
        "The router stopped handing out addresses; restarting it fixed it."
    });

    expect(summary).toContain("Connected to Wi-Fi but pages don't load.");
    expect(summary).toContain("Started: after yesterday's update");
    expect(summary).toContain(`1. ${first.title}: didn't work`);
    expect(summary).toContain(`2. ${second.title}: worked`);
    expect(summary).toContain("restarting it fixed it");
    expect(summary).not.toContain(first.id);
  });
});
