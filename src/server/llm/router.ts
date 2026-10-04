import type { LanguageModelV4 } from "@ai-sdk/provider";
import {
  streamText,
  stepCountIs,
  pruneMessages,
  type UIMessageStreamWriter,
  type UIMessage,
  type ToolSet,
  convertToModelMessages
} from "ai";
import type { ModelEntry } from "./models.config";
import { classify } from "./classify";
import type { ChaosFlags } from "./chaos";
import { shouldChaos } from "./chaos";
import {
  type ReserveRequest,
  type ReserveOutcome,
  type DispatchOutcome,
  type ReconcileOutcome,
  type Usage,
  type ReservationEntry,
  type QuotaKey,
  computeWindow
} from "../agents/coordinator-logic";

export interface TurnRequest {
  system: string;
  messages: UIMessage[];
  tools?: ToolSet;
  privacyMode: boolean;
  abortSignal?: AbortSignal;
  envelope: { sessionId: string; turnId: string };
  estimate: { inputTokens: number; maxOutputTokens: number };
  maxSteps?: number;
}

export type TurnResult =
  | { ok: true; modelKey: string; usage?: Usage }
  | { ok: false; reason: "no_provider" | "deadline" | "quota_denied" };

export interface RouterContext {
  candidates: ModelEntry[];
  getModel: (entry: ModelEntry) => LanguageModelV4;
  report: (key: string, result: ReportResult) => void;
  isCooling: (key: string) => boolean;
  chaos: ChaosFlags;
  reserve: (req: ReserveRequest) => Promise<ReserveOutcome>;
  dispatch: (leaseId: string) => Promise<DispatchOutcome>;
  reconcile: (leaseId: string, usage: Usage) => Promise<ReconcileOutcome>;
  limits: Record<string, number>;
  configVersion: string;
}

export type ReportResult =
  | { ok: true }
  | { ok: false; errorClass: ReturnType<typeof classify> };

const TURN_DEADLINE_MS = 20_000;
const MAX_ATTEMPTS = 3;

export function buildReservationEntries(
  entry: ModelEntry,
  estimate: { inputTokens: number; maxOutputTokens: number },
  now: number
): ReservationEntry[] {
  const qk: QuotaKey = {
    provider: entry.provider,
    org: "default",
    project: "default",
    quotaGroup: entry.quotaGroup
  };
  const entries: ReservationEntry[] = [];
  const totalTokens = estimate.inputTokens + estimate.maxOutputTokens;

  for (const kind of ["minute", "day"] as const) {
    const w = computeWindow(entry.provider, kind, now);
    entries.push({ quotaKey: qk, window: w, dimension: "requests", amount: 1 });
    entries.push({
      quotaKey: qk,
      window: w,
      dimension: "totalTokens",
      amount: totalTokens
    });
  }

  if (entry.neuronRate) {
    const w = computeWindow(entry.provider, "day", now);
    const neurons =
      (estimate.inputTokens / 1e6) * entry.neuronRate.inputPerMillion +
      (estimate.maxOutputTokens / 1e6) * entry.neuronRate.outputPerMillion;
    entries.push({
      quotaKey: qk,
      window: w,
      dimension: "neurons",
      amount: Math.ceil(neurons)
    });
  }

  return entries;
}

export async function streamTurn(
  ctx: RouterContext,
  role: string,
  req: TurnRequest,
  writer: UIMessageStreamWriter
): Promise<TurnResult> {
  const deadline = Date.now() + TURN_DEADLINE_MS;
  const candidates = ctx.candidates.filter((c) => !ctx.isCooling(c.key));
  let partial = "";
  let quotaDenied = false;

  for (
    let attempt = 0;
    attempt < Math.min(MAX_ATTEMPTS, candidates.length);
    attempt++
  ) {
    const candidate = candidates[attempt];
    if (Date.now() > deadline) break;

    if (shouldChaos(ctx.chaos, "all_down")) {
      ctx.report(candidate.key, {
        ok: false,
        errorClass: { kind: "server_error", cooldownMs: 60000 }
      });
      continue;
    }

    const ctrl = new AbortController();
    const onUserAbort = () => ctrl.abort("user");
    req.abortSignal?.addEventListener("abort", onUserAbort);

    const ttft = setTimeout(() => ctrl.abort("ttft"), candidate.ttftMs);

    if (shouldChaos(ctx.chaos, "429")) {
      clearTimeout(ttft);
      req.abortSignal?.removeEventListener("abort", onUserAbort);
      ctx.report(candidate.key, {
        ok: false,
        errorClass: { kind: "rate_limit", cooldownMs: 60000, retryAfterSec: 60 }
      });
      continue;
    }

    if (shouldChaos(ctx.chaos, "timeout")) {
      clearTimeout(ttft);
      req.abortSignal?.removeEventListener("abort", onUserAbort);
      ctx.report(candidate.key, {
        ok: false,
        errorClass: { kind: "timeout", cooldownMs: 20000 }
      });
      continue;
    }

    const resEntries = buildReservationEntries(
      candidate,
      req.estimate,
      Date.now()
    );
    const reserveReq: ReserveRequest = {
      requestId: `${req.envelope.sessionId}-${req.envelope.turnId}-${attempt}`,
      sessionId: req.envelope.sessionId,
      turnId: req.envelope.turnId,
      attempt: attempt + 1,
      configVersion: ctx.configVersion,
      idempotencyKey: `${req.envelope.sessionId}-${req.envelope.turnId}-${attempt}`,
      entries: resEntries,
      estimate: req.estimate
    };

    const reserveOutcome = await ctx.reserve(reserveReq);

    if (!reserveOutcome.ok) {
      clearTimeout(ttft);
      req.abortSignal?.removeEventListener("abort", onUserAbort);
      if (reserveOutcome.reason === "coordinator_unavailable") {
        return { ok: false, reason: "quota_denied" };
      }
      if (reserveOutcome.reason === "quota_exhausted") {
        quotaDenied = true;
        ctx.report(candidate.key, {
          ok: false,
          errorClass: {
            kind: "rate_limit",
            cooldownMs: 60_000,
            retryAfterSec: 60
          }
        });
        continue;
      }
      if (reserveOutcome.reason === "model_disabled") {
        continue;
      }
    }

    const leaseId = reserveOutcome.ok ? reserveOutcome.lease.leaseId : null;

    if (leaseId) {
      const dispatchOutcome = await ctx.dispatch(leaseId);
      if (!dispatchOutcome.ok && dispatchOutcome.reason === "not_found") {
        clearTimeout(ttft);
        req.abortSignal?.removeEventListener("abort", onUserAbort);
        continue;
      }
    }

    let gotFirst = false;
    let streamCut = false;
    let actualUsage: Usage = {};

    try {
      const model = ctx.getModel(candidate);
      const uiMessages = partial
        ? withContinuation(req.messages, partial)
        : req.messages;
      const modelMessages = await convertToModelMessages(uiMessages);
      if (modelMessages.length === 0) {
        return { ok: false, reason: "no_provider" };
      }
      const messages = pruneMessages({
        messages: modelMessages,
        toolCalls: "before-last-2-messages",
        reasoning: "before-last-message"
      });

      const result = streamText({
        model,
        system: req.system,
        messages,
        tools: req.tools,
        maxRetries: 0,
        stopWhen: stepCountIs(req.maxSteps ?? 4),
        abortSignal: ctrl.signal
      });

      for await (const chunk of result.toUIMessageStream()) {
        if (!gotFirst) {
          gotFirst = true;
          clearTimeout(ttft);
        }

        if (shouldChaos(ctx.chaos, "cut") && gotFirst) {
          streamCut = true;
          break;
        }

        writer.write(chunk);
        if (chunk.type === "text-delta") {
          partial += (chunk as { delta?: string }).delta ?? "";
        }
      }

      try {
        const usage = await result.usage;
        actualUsage = {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)
        };
      } catch {
        actualUsage = {
          totalTokens: req.estimate.inputTokens + req.estimate.maxOutputTokens
        };
      }

      if (streamCut) {
        ctx.report(candidate.key, {
          ok: false,
          errorClass: { kind: "network_error", cooldownMs: 30000 }
        });
        if (leaseId) {
          await ctx.reconcile(leaseId, actualUsage);
        }
        continue;
      }

      ctx.report(candidate.key, { ok: true });
      if (leaseId) {
        await ctx.reconcile(leaseId, actualUsage);
      }
      return { ok: true, modelKey: candidate.key, usage: actualUsage };
    } catch (e) {
      clearTimeout(ttft);
      if (req.abortSignal?.aborted) {
        if (leaseId) {
          await ctx.reconcile(leaseId, actualUsage);
        }
        throw e;
      }
      ctx.report(candidate.key, { ok: false, errorClass: classify(e) });
      if (leaseId) {
        await ctx.reconcile(leaseId, actualUsage);
      }
      continue;
    } finally {
      req.abortSignal?.removeEventListener("abort", onUserAbort);
    }
  }

  if (Date.now() > deadline) {
    return { ok: false, reason: "deadline" };
  }
  if (quotaDenied) {
    return { ok: false, reason: "quota_denied" };
  }
  return { ok: false, reason: "no_provider" };
}

function withContinuation(messages: UIMessage[], partial: string): UIMessage[] {
  if (!partial) return messages;
  const lastIdx = messages.length - 1;
  if (lastIdx < 0) return messages;
  const last = messages[lastIdx];
  const continuation: UIMessage = {
    ...last,
    id: last.id + "-cont",
    parts: [
      ...last.parts,
      {
        type: "text",
        text: `Your previous reply was cut off after: «${partial.slice(-200)}». Continue naturally without repeating.`
      }
    ]
  };
  return [...messages.slice(0, lastIdx), continuation];
}
