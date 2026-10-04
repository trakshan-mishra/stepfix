import { routeAgentRequest } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessageStreamWriter
} from "ai";
import { nanoid } from "nanoid";
import { handleLibraryRequest } from "./server/http/library";
import { handleSessionRequest } from "./server/http/session";
import { handleAdminRequest } from "./server/http/admin";
import { handleFeedbackRequest } from "./server/http/feedback";
import { handleAudioRequest } from "./server/http/audio";
import { generateSitemap } from "./server/seo";
import { verifyToken } from "./server/http/token";
import { createMockModel } from "./server/llm/mock";
import { Coordinator } from "./server/agents/coordinator";
import { buildTools, handleStepResult } from "./server/agent/tools";
import {
  buildSystemPrompt,
  formatCatalogSubset,
  prepareMessagesForModel
} from "./server/agent/prepare-messages";
import { scanForCommands } from "./server/guardrails/command-scanner";
import { type CaseFile, type Step, type Phase } from "./server/agent/case-file";
import {
  streamTurn,
  type RouterContext,
  type TurnRequest
} from "./server/llm/router";
import {
  buildRegistry,
  isActionable,
  CF_NEURONS_PER_DAY,
  type ModelEntry
} from "./server/llm/models.config";
import { getModel } from "./server/llm/providers";
import { playbookReply } from "./server/playbook/engine";
import { effectiveChaos, type ChaosFlags } from "./server/llm/chaos";
import {
  type ReserveRequest,
  type ReserveOutcome,
  type DispatchOutcome,
  type ReconcileOutcome,
  type Usage,
  type Reservation
} from "./server/agents/coordinator-logic";
import "./server/env-extra";

export { Coordinator };

interface SessionState {
  phase: Phase;
  caseFile: CaseFile;
  steps: Step[];
  degraded: boolean;
  counters: { userMessages: number; screenshots: number; violations: number };
  privacyMode: boolean;
  createdAt: number;
  lastActiveAt: number;
  reportId?: string;
}

const INITIAL_STATE: SessionState = {
  phase: "support" as Phase,
  caseFile: { os: "unknown", facts: [], caseVersion: 0 },
  steps: [],
  degraded: false,
  counters: { userMessages: 0, screenshots: 0, violations: 0 },
  privacyMode: false,
  createdAt: 0,
  lastActiveAt: 0
};

export class SupportSession extends AIChatAgent<Env, SessionState> {
  maxPersistedMessages = 200;

  onStart() {
    if (!this.state || !this.state.createdAt) {
      this.setState({
        ...INITIAL_STATE,
        createdAt: Date.now(),
        lastActiveAt: Date.now()
      });
    }
    this.schedule(24 * 3600, "executePurge", undefined, {
      idempotent: true
    });
  }

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    if (!this.state) {
      this.setState({
        ...INITIAL_STATE,
        createdAt: Date.now(),
        lastActiveAt: Date.now()
      });
    }
    this.setState({
      ...this.state,
      lastActiveAt: Date.now(),
      counters: {
        ...this.state.counters,
        userMessages: this.state.counters.userMessages + 1
      }
    });

    const lastMessage = this.messages[this.messages.length - 1];
    const metadata = lastMessage?.metadata as
      | Record<string, unknown>
      | undefined;
    const kind = metadata?.kind as string | undefined;

    if (kind === "step_result") {
      const stepId = metadata?.stepId as string;
      const status = metadata?.status as
        | "ran"
        | "worked"
        | "failed"
        | "cant_run";
      const output = metadata?.output as string | undefined;
      handleStepResult(
        {
          state: this.state,
          setState: (s) => this.setState(s as SessionState),
          sessionId: this.name
        },
        stepId,
        status,
        output
      );
    }

    const useMock = (this.env.LLM_MODE as string) === "mock";
    const chaos: ChaosFlags = effectiveChaos(
      this.env.CHAOS ?? "",
      this.env.APP_ENV ?? "development"
    );

    const phase = this.state.phase;
    const catalogSubset =
      phase === "technician"
        ? formatCatalogSubset(
            this.state.caseFile.os,
            this.state.caseFile.category ?? "bluetooth"
          )
        : "";
    const systemPrompt = buildSystemPrompt(
      phase,
      this.state.caseFile,
      this.state.steps,
      catalogSubset
    );

    const tools = buildTools({
      state: this.state,
      setState: (s) => this.setState(s as SessionState),
      sessionId: this.name
    });

    const preparedMessages = prepareMessagesForModel(
      this.messages,
      this.state.steps
    );

    if (preparedMessages.length === 0) {
      const stream = createUIMessageStream({
        execute: async ({ writer }) => {
          writer.write({ type: "text-start", id: "empty" } as never);
          writer.write({
            type: "text-delta",
            id: "empty",
            delta: "Send a message to start."
          } as never);
          writer.write({ type: "text-end", id: "empty" } as never);
        },
        onError: () => "An error occurred."
      });
      return createUIMessageStreamResponse({ stream });
    }

    const ctx = useMock
      ? buildMockRouterContext(this.env, chaos)
      : await buildLiveRouterContext(this.env, chaos);

    const turnReq: TurnRequest = {
      system: systemPrompt,
      messages: preparedMessages,
      tools,
      privacyMode: this.state.privacyMode,
      abortSignal: options?.abortSignal,
      envelope: { sessionId: this.name, turnId: nanoid(12) },
      estimate: { inputTokens: 1000, maxOutputTokens: 500 },
      maxSteps: useMock ? 1 : 4
    };

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        let assistantText = "";
        const trackingWriter = {
          write: (chunk: Parameters<typeof writer.write>[0]) => {
            writer.write(chunk);
            if (chunk.type === "text-delta") {
              assistantText += (chunk as { delta?: string }).delta ?? "";
            }
          }
        } as UIMessageStreamWriter;

        const result = await streamTurn(ctx, phase, turnReq, trackingWriter);

        if (!result.ok) {
          const reason = !result.ok ? result.reason : "";
          const pb = playbookReply({
            phase: phase as Phase,
            caseFile: this.state.caseFile,
            steps: this.state.steps,
            degraded: true
          });
          writer.write({ type: "text-start", id: "pb" } as never);
          writer.write({
            type: "text-delta",
            id: "pb",
            delta: `[backup mode: ${reason}] ${pb.text}`
          } as never);
          writer.write({ type: "text-end", id: "pb" } as never);
          assistantText = pb.text;
        }

        const scan = scanForCommands(assistantText);
        if (scan.hit) {
          this.setState({
            ...this.state,
            counters: {
              ...this.state.counters,
              violations: this.state.counters.violations + 1
            }
          });
        }
      },
      onError: () => "An error occurred during support."
    });

    return createUIMessageStreamResponse({ stream });
  }

  async executePurge() {
    this.setState({ ...INITIAL_STATE, createdAt: 0 });
    try {
      await this.saveMessages(() => []);
    } catch {
      // best effort — SDK storage may be unavailable
    }
  }

  async onRequest(request: Request): Promise<Response> {
    if (
      request.method === "POST" &&
      new URL(request.url).pathname === "/purge"
    ) {
      await this.executePurge();
      return new Response('{"status":"purged"}', {
        headers: { "content-type": "application/json" }
      });
    }
    return new Response("Not found", { status: 404 });
  }
}

function buildMockRouterContext(env: Env, chaos: ChaosFlags): RouterContext {
  const mockEntry: ModelEntry = {
    key: "mock:model",
    provider: "groq",
    modelId: "mock-model",
    roles: ["support", "technician"],
    caps: { tools: true, vision: false },
    quotaGroup: "mock",
    limits: {},
    effectiveLimits: null,
    accountVerified: true,
    runtimeEnabled: true,
    freeEligibilityVerified: true,
    privacyConfigVerified: true,
    trainsOnInputs: false,
    ttftMs: 1000,
    paid: false
  };

  const mockLease: Reservation = {
    leaseId: "mock-lease",
    request: {} as ReserveRequest,
    entries: [],
    estimate: { inputTokens: 0, maxOutputTokens: 0 },
    status: "reserved"
  };

  return {
    candidates: [mockEntry],
    getModel: () => createMockModel() as never,
    report: () => {},
    isCooling: () => false,
    chaos,
    reserve: async () => ({ ok: true, lease: mockLease }) as ReserveOutcome,
    dispatch: async (leaseId: string) =>
      ({
        ok: true,
        lease: { ...mockLease, leaseId, status: "dispatched" as const }
      }) as DispatchOutcome,
    reconcile: async (leaseId: string) =>
      ({
        ok: true,
        lease: { ...mockLease, leaseId, status: "reconciled" as const }
      }) as ReconcileOutcome,
    limits: {},
    configVersion: "mock"
  };
}

async function buildLiveRouterContext(
  env: Env,
  chaos: ChaosFlags
): Promise<RouterContext> {
  const registry = buildRegistry(
    env as unknown as Record<string, string | undefined>
  );
  const actionable = registry.filter(isActionable);

  const coordinatorId = env.Coordinator.idFromName("global");
  const coordinator = env.Coordinator.get(coordinatorId) as unknown as {
    reserve(
      req: ReserveRequest,
      limits: Record<string, number>
    ): Promise<ReserveOutcome>;
    dispatch(leaseId: string): Promise<DispatchOutcome>;
    reconcile(leaseId: string, usage: Usage): Promise<ReconcileOutcome>;
  };

  const limits: Record<string, number> = {};
  for (const entry of actionable) {
    const qk = `${entry.provider}:default:default:${entry.quotaGroup}`;
    const eff = entry.effectiveLimits ?? entry.limits;
    if (eff.rpm) limits[`${qk}:minute:requests`] = eff.rpm;
    if (eff.tpm) limits[`${qk}:minute:totalTokens`] = eff.tpm;
    if (eff.rpd) limits[`${qk}:day:requests`] = eff.rpd;
    if (eff.tpd) limits[`${qk}:day:totalTokens`] = eff.tpd;
  }
  if (actionable.some((e) => e.provider === "workers-ai")) {
    limits["workers-ai:default:default:cf-account-neurons:day:neurons"] =
      CF_NEURONS_PER_DAY;
  }

  return {
    candidates: actionable,
    getModel: (entry: ModelEntry) =>
      getModel(
        entry,
        env as unknown as Record<string, string | undefined>,
        env.AI
      ),
    report: () => {},
    isCooling: () => false,
    chaos,
    reserve: (req: ReserveRequest) => coordinator.reserve(req, limits),
    dispatch: (leaseId: string) => coordinator.dispatch(leaseId),
    reconcile: (leaseId: string, usage: Usage) =>
      coordinator.reconcile(leaseId, usage),
    limits,
    configVersion: "v1"
  };
}

export default {
  async fetch(request: Request, env: Env) {
    const libraryResponse = handleLibraryRequest(request);
    if (libraryResponse) return libraryResponse;

    const sessionResponse = await handleSessionRequest(request, env);
    if (sessionResponse) return sessionResponse;

    const adminResponse = await handleAdminRequest(request, env);
    if (adminResponse) return adminResponse;

    const feedbackResponse = await handleFeedbackRequest(request, env);
    if (feedbackResponse) return feedbackResponse;

    const audioResponse = await handleAudioRequest(request, env);
    if (audioResponse) return audioResponse;

    const url = new URL(request.url);
    if (url.pathname === "/sitemap.xml") {
      return new Response(generateSitemap("https://stepfix.workers.dev"), {
        headers: { "content-type": "application/xml" }
      });
    }

    if (new URL(request.url).pathname.startsWith("/agents/")) {
      const url = new URL(request.url);
      const auth = url.searchParams.get("token") ?? "";
      if (!auth) {
        return new Response("Unauthorized", { status: 401 });
      }
      const signingKey = env.SESSION_SIGNING_KEY ?? "dev-key-change-me";
      const verified = await verifyToken(auth, signingKey);
      if (!verified.ok) {
        return new Response("Unauthorized", { status: 401 });
      }
      const pathParts = url.pathname.split("/");
      const routeId = pathParts[3];
      if (routeId && verified.sessionId !== routeId) {
        return new Response("Forbidden", { status: 403 });
      }
    }

    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
