import { z } from "zod";
import { tool } from "ai";
import { nanoid } from "nanoid";
import {
  type CaseFile,
  type Step,
  missingForHandoff,
  CaseFile as CaseFileSchema,
  type WorkflowState
} from "./case-file";
import { catalogFor, getScript, renderCommand } from "../library/index";
import { buildEscalationReport } from "../report/escalation";
import { buildResolutionSummary } from "../report/summary";
import { transition } from "./phases";
import { wrapUntrusted, truncateForUntrusted } from "../guardrails/untrusted";
import { scrub } from "../guardrails/scrub";
import { canRecommend, decideNext, purposeOf, workflowState } from "./workflow";

export interface ToolContext {
  state: {
    phase: string;
    caseFile: CaseFile;
    steps: Step[];
    counters: { userMessages: number; screenshots: number; violations: number };
    reportId?: string;
    workflow?: WorkflowState;
    finalArtifact?: { kind: "resolved" | "escalated"; markdown: string };
  };
  setState: (state: ToolContext["state"]) => void;
  sessionId: string;
}

type ToolResult = Record<string, unknown>;

export function buildTools(ctx: ToolContext) {
  return {
    update_case: tool({
      description:
        "Update the case file with information collected from the user.",
      inputSchema: z.object({
        os: z
          .enum([
            "windows11",
            "windows10",
            "ubuntu",
            "debian",
            "linux_other",
            "unknown"
          ])
          .optional(),
        osVersion: z.string().max(40).optional(),
        device: z.string().max(80).optional(),
        category: z.enum(["bluetooth", "wifi", "dev_cli", "other"]).optional(),
        symptom: z.string().max(300).optional(),
        originalTask: z.string().max(300).optional(),
        errorText: z.string().max(500).optional(),
        whenStarted: z.string().max(120).optional(),
        whatChanged: z.string().max(200).optional(),
        userSkill: z.enum(["novice", "intermediate", "expert"]).optional(),
        canUseAdmin: z.boolean().optional(),
        fact: z
          .object({ key: z.string().max(60), value: z.string().max(500) })
          .optional(),
        summary: z.string().max(400).optional()
      }),
      execute: async (input): Promise<ToolResult> => {
        if (["resolved", "escalated", "closed"].includes(ctx.state.phase))
          return { ok: false, error: "This session has ended." };
        const cf = { ...ctx.state.caseFile };
        for (const key of [
          "os",
          "osVersion",
          "device",
          "category",
          "symptom",
          "originalTask",
          "errorText",
          "whenStarted",
          "whatChanged",
          "userSkill",
          "canUseAdmin",
          "summary"
        ] as const) {
          if (input[key] !== undefined)
            (cf as Record<string, unknown>)[key] = input[key];
        }
        if (input.fact) {
          cf.facts = [
            ...cf.facts,
            { ...input.fact, source: "user" as const, at: Date.now() }
          ];
        }
        const parsed = CaseFileSchema.parse(cf);
        ctx.state.caseFile = parsed;
        ctx.setState(ctx.state);
        return {
          caseFile: parsed,
          missingForHandoff: missingForHandoff(parsed)
        };
      }
    }),

    handoff_to_technician: tool({
      description:
        "Hand the case to the Technician. Requires a complete case file.",
      inputSchema: z.object({
        summary: z.string().max(400)
      }),
      execute: async (input): Promise<ToolResult> => {
        if (ctx.state.phase !== "support")
          return { ok: false, error: "Triage has already ended." };
        const missing = missingForHandoff(ctx.state.caseFile);
        if (missing.length > 0) {
          return { ok: false, missing };
        }
        const { os, category } = ctx.state.caseFile;
        if (!category || catalogFor(os, category).length === 0) {
          return {
            ok: false,
            reason: "out_of_scope",
            supported: [
              "Wi-Fi/internet",
              "Bluetooth",
              "command-line tools not found or not installing"
            ]
          };
        }
        ctx.state.caseFile.summary = input.summary;
        ctx.state.caseFile.caseVersion += 1;
        ctx.state.phase = transition(ctx.state.phase as never, "technician");
        ctx.setState(ctx.state);
        return {
          ok: true,
          caseVersion: ctx.state.caseFile.caseVersion,
          next: "You are now the Technician. In this same reply, recommend the first step."
        };
      }
    }),

    recommend_step: tool({
      description:
        "Recommend one step from the script library. Only one per turn.",
      inputSchema: z.object({
        scriptId: z.string(),
        params: z.record(z.string(), z.string()).optional(),
        whyNow: z.string().max(300)
      }),
      execute: async (input): Promise<ToolResult> => {
        if (ctx.state.steps.some((s) => s.status === "pending")) {
          return {
            ok: false,
            error: "A step is already pending. Wait for its result."
          };
        }

        const script = getScript(input.scriptId);
        if (!script) {
          return { ok: false, error: `Unknown script id: ${input.scriptId}` };
        }

        const os = ctx.state.caseFile.os;
        if (!script.os.includes(os)) {
          return {
            ok: false,
            error: `Script ${input.scriptId} does not support OS "${os}" (supports: ${script.os.join(", ")})`
          };
        }

        const params = input.params ?? {};
        const refusal = canRecommend(ctx.state, input.scriptId);
        if (refusal) return { ok: false, error: refusal };
        const renderResult =
          script.kind === "manual"
            ? { ok: true as const, command: undefined }
            : renderCommand(script, params);
        if (!renderResult.ok) {
          return { ok: false, error: renderResult.error };
        }

        const stepId = nanoid(12);
        const step: Step = {
          stepId,
          scriptId: script.id,
          scriptVersion: script.version,
          params,
          renderedCommand: renderResult.command,
          whyNow: input.whyNow,
          status: "pending",
          matchedPatterns: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          source: "llm"
        };

        ctx.state.steps.push(step);
        ctx.state.workflow = workflowState(ctx.state);
        ctx.setState(ctx.state);

        const card = {
          stepId,
          scriptId: script.id,
          version: script.version,
          hash: script.hash,
          title: script.title,
          os: script.os.join(", "),
          shell: script.shell,
          risk: script.risk,
          needsAdmin: script.needs_admin,
          kind: script.kind,
          purpose: purposeOf(script),
          verifiesOriginalTask: script.verifies_original_task,
          command: renderResult.command,
          manualSteps: script.manual_steps,
          deepLink: script.deep_link ?? undefined,
          explanation: script.explanation,
          expect: script.expect,
          undo: script.undo ?? undefined,
          sources: script.sources,
          whyNow: input.whyNow
        };

        return { ok: true, card };
      }
    }),

    search_kb: tool({
      description: "Search the knowledge base for relevant articles.",
      inputSchema: z.object({
        query: z.string().max(200),
        os: z
          .enum([
            "windows11",
            "windows10",
            "ubuntu",
            "debian",
            "linux_other",
            "unknown"
          ])
          .optional(),
        category: z.enum(["bluetooth", "wifi", "dev_cli", "other"]).optional()
      }),
      execute: async (): Promise<ToolResult> => {
        return {
          results: [],
          note: "KB search requires D1 binding (not available in test context)."
        };
      }
    }),

    request_screenshot: tool({
      description: "Ask the user to share a screenshot.",
      inputSchema: z.object({
        reason: z.string().max(200)
      }),
      execute: async (_input): Promise<ToolResult> => {
        if (ctx.state.counters.screenshots >= 6) {
          return { ok: false, error: "cap" };
        }
        return { ok: true };
      }
    }),

    escalate_to_human: tool({
      description: "Escalate to a human with a full diagnostic report.",
      inputSchema: z.object({
        reason: z.string().max(300),
        likelyCause: z.string().max(300).optional()
      }),
      execute: async (input): Promise<ToolResult> => {
        if (["resolved", "escalated", "closed"].includes(ctx.state.phase))
          return { ok: false, error: "This session has ended." };
        const report = buildEscalationReport({
          sessionId: ctx.sessionId,
          caseFile: ctx.state.caseFile,
          steps: ctx.state.steps,
          reason: input.reason,
          likelyCause: input.likelyCause,
          phase: "escalated"
        });
        ctx.state.caseFile.caseVersion += 1;
        ctx.state.phase = transition(ctx.state.phase as never, "escalated");
        ctx.state.reportId = nanoid(12);
        ctx.state.workflow = workflowState(ctx.state);
        ctx.state.finalArtifact = { kind: "escalated", markdown: report };
        ctx.setState(ctx.state);
        return {
          ok: true,
          notified: false,
          reportId: ctx.state.reportId,
          markdown: report,
          instruction:
            "Nobody has been notified. Tell the user they can copy or download this report and send it to someone who helps them with tech, or post it on a help forum."
        };
      }
    }),

    mark_resolved: tool({
      description:
        "Produce a fix summary only when the server has a successful original-task verification recorded from the user.",
      inputSchema: z.object({}),
      execute: async (): Promise<ToolResult> => {
        const decision = decideNext(ctx.state);
        if (ctx.state.phase !== "technician" || decision.kind !== "resolve")
          return {
            ok: false,
            error:
              "Original task not confirmed by a successful verification card. Continue diagnosis or request its result."
          };
        ctx.state.caseFile.caseVersion += 1;
        ctx.state.phase = transition(ctx.state.phase as never, "resolved");
        ctx.state.workflow = workflowState(ctx.state);
        const summary = buildResolutionSummary({
          caseFile: ctx.state.caseFile,
          steps: ctx.state.steps,
          rootCause: decision.rootCause
        });
        ctx.state.finalArtifact = { kind: "resolved", markdown: summary };
        ctx.setState(ctx.state);
        return {
          ok: true,
          rootCause: decision.rootCause,
          summary
        };
      }
    }),

    handback_to_support: tool({
      description:
        "Hand the case back to the Support agent (non-technical issue).",
      inputSchema: z.object({
        reason: z.string().max(200)
      }),
      execute: async (_input): Promise<ToolResult> => {
        if (ctx.state.phase !== "technician")
          return { ok: false, error: "This session is not troubleshooting." };
        ctx.state.caseFile.caseVersion += 1;
        ctx.state.phase = transition(ctx.state.phase as never, "support");
        ctx.setState(ctx.state);
        return { ok: true, caseVersion: ctx.state.caseFile.caseVersion };
      }
    })
  };
}

export function handleStepResult(
  ctx: ToolContext,
  stepId: string,
  status: "ran" | "worked" | "failed" | "cant_run",
  output?: string
): { updated: boolean; step?: Step } {
  const step = ctx.state.steps.find((s) => s.stepId === stepId);
  if (
    ctx.state.phase !== "technician" ||
    !step ||
    step !== ctx.state.steps.at(-1) ||
    (step.status !== "pending" && !step.awaitingEvidence)
  ) {
    return { updated: false };
  }

  const scrubbedOutput =
    output !== undefined ? truncateForUntrusted(scrub(output).text) : undefined;
  const matchedPatterns: string[] = [];

  if (scrubbedOutput !== undefined) {
    const script = getScript(step.scriptId);
    if (script) {
      for (const expect of script.expect) {
        try {
          const re = new RegExp(expect.pattern, "im");
          if (re.test(scrubbedOutput)) {
            matchedPatterns.push(expect.pattern);
          }
        } catch {
          // skip invalid regex
        }
      }
    }
  }

  const script = getScript(step.scriptId);
  step.status =
    status === "worked" && script && !script.verifies_original_task
      ? "ran"
      : status;
  step.output = scrubbedOutput;
  step.matchedPatterns = matchedPatterns;
  step.updatedAt = Date.now();
  step.awaitingEvidence = false;
  const decision = decideNext(ctx.state);
  if (decision.kind === "request_output") {
    step.awaitingEvidence = true;
    step.clarificationAttempts = (step.clarificationAttempts ?? 0) + 1;
  }
  ctx.state.workflow = workflowState(ctx.state);

  ctx.setState(ctx.state);
  return { updated: true, step };
}

export { wrapUntrusted, truncateForUntrusted };
