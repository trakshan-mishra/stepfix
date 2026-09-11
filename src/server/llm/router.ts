import type { LanguageModelV4 } from "@ai-sdk/provider";
import {
  streamText,
  type UIMessageStreamWriter,
  type UIMessage,
  type ToolSet,
  convertToModelMessages
} from "ai";
import type { ModelEntry } from "./models.config";
import { classify } from "./classify";
import type { ChaosFlags } from "./chaos";
import { shouldChaos } from "./chaos";

export interface TurnRequest {
  system: string;
  messages: UIMessage[];
  tools?: ToolSet;
  privacyMode: boolean;
  abortSignal?: AbortSignal;
}

export type TurnResult =
  | { ok: true; modelKey: string }
  | { ok: false; reason: "no_provider" | "deadline" };

export interface RouterContext {
  candidates: ModelEntry[];
  getModel: (entry: ModelEntry) => LanguageModelV4;
  report: (key: string, result: ReportResult) => void;
  isCooling: (key: string) => boolean;
  chaos: ChaosFlags;
}

export type ReportResult =
  | { ok: true }
  | { ok: false; errorClass: ReturnType<typeof classify> };

const TURN_DEADLINE_MS = 20_000;

export async function streamTurn(
  ctx: RouterContext,
  role: string,
  req: TurnRequest,
  writer: UIMessageStreamWriter
): Promise<TurnResult> {
  const deadline = Date.now() + TURN_DEADLINE_MS;
  const candidates = ctx.candidates.filter((c) => !ctx.isCooling(c.key));
  let partial = "";

  for (const candidate of candidates) {
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

    let gotFirst = false;
    let streamCut = false;

    try {
      const model = ctx.getModel(candidate);
      const uiMessages = partial
        ? withContinuation(req.messages, partial)
        : req.messages;
      const messages = await convertToModelMessages(uiMessages);

      const result = streamText({
        model,
        system: req.system,
        messages,
        tools: req.tools,
        maxRetries: 0,
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

      if (streamCut) {
        ctx.report(candidate.key, {
          ok: false,
          errorClass: { kind: "network_error", cooldownMs: 30000 }
        });
        continue;
      }

      ctx.report(candidate.key, { ok: true });
      return { ok: true, modelKey: candidate.key };
    } catch (e) {
      clearTimeout(ttft);
      if (req.abortSignal?.aborted) {
        throw e;
      }
      ctx.report(candidate.key, { ok: false, errorClass: classify(e) });
      continue;
    } finally {
      req.abortSignal?.removeEventListener("abort", onUserAbort);
    }
  }

  return {
    ok: false,
    reason: Date.now() > deadline ? "deadline" : "no_provider"
  };
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
