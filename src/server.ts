import { routeAgentRequest } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import {
  convertToModelMessages,
  pruneMessages,
  stepCountIs,
  streamText
} from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { handleLibraryRequest } from "./server/http/library";
import { handleSessionRequest } from "./server/http/session";
import { verifyToken } from "./server/http/token";
import { createMockModel } from "./server/llm/mock";
import { Coordinator } from "./server/agents/coordinator";
import "./server/env-extra";

export { Coordinator };

type Phase = "support" | "technician" | "resolved" | "escalated" | "closed";

interface StepRecord {
  stepId: string;
  scriptId: string;
  status: string;
  createdAt: number;
}

interface SessionState {
  phase: Phase;
  caseFile: Record<string, unknown>;
  steps: StepRecord[];
  degraded: boolean;
  counters: { userMessages: number; screenshots: number; violations: number };
  privacyMode: boolean;
  createdAt: number;
  lastActiveAt: number;
  reportId?: string;
}

const INITIAL_STATE: SessionState = {
  phase: "support",
  caseFile: {},
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
    if (!this.state.createdAt) {
      this.setState({
        ...INITIAL_STATE,
        createdAt: Date.now(),
        lastActiveAt: Date.now()
      });
    }

    this.schedule(24 * 3600, "executePurge");
  }

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    this.setState({
      ...this.state,
      lastActiveAt: Date.now(),
      counters: {
        ...this.state.counters,
        userMessages: this.state.counters.userMessages + 1
      }
    });

    const useMock = this.env.LLM_MODE === "mock";
    const model = useMock
      ? createMockModel()
      : (() => {
          const workersai = createWorkersAI({ binding: this.env.AI });
          return workersai("@cf/moonshotai/kimi-k2.7-code", {
            sessionAffinity: this.sessionAffinity
          });
        })();

    const systemPrompt = this.buildSystemPrompt();

    const result = streamText({
      model,
      system: systemPrompt,
      messages: pruneMessages({
        messages: await convertToModelMessages(this.messages),
        toolCalls: "before-last-2-messages",
        reasoning: "before-last-message"
      }),
      stopWhen: stepCountIs(4),
      abortSignal: options?.abortSignal
    });

    return result.toUIMessageStreamResponse();
  }

  async executePurge() {
    this.setState({ ...INITIAL_STATE, createdAt: 0 });
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

  private buildSystemPrompt(): string {
    const state = this.state;
    const phaseLabel = state.phase;
    return `You are stepfix, an AI support agent (${phaseLabel} phase). You help users fix their own computer problems on Linux (Ubuntu/Debian) and Windows 10/11. Be concise and friendly. You are an AI; if asked, say so. You never give commands in your text — commands appear only through script cards.`;
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const libraryResponse = handleLibraryRequest(request);
    if (libraryResponse) return libraryResponse;

    const sessionResponse = await handleSessionRequest(request, env);
    if (sessionResponse) return sessionResponse;

    if (new URL(request.url).pathname.startsWith("/agents/")) {
      const auth = new URL(request.url).searchParams.get("token") ?? "";
      if (auth) {
        const signingKey = env.SESSION_SIGNING_KEY ?? "dev-key-change-me";
        const verified = await verifyToken(auth, signingKey);
        if (!verified.ok) {
          return new Response("Unauthorized", { status: 401 });
        }
      }
    }

    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
