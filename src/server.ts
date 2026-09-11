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
import { handleAdminRequest } from "./server/http/admin";
import { handleFeedbackRequest } from "./server/http/feedback";
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
  caseFile: { os: "unknown", facts: [] },
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
    const model = useMock
      ? createMockModel()
      : (() => {
          const workersai = createWorkersAI({ binding: this.env.AI });
          return workersai("@cf/zai-org/glm-4.7-flash", {
            sessionAffinity: this.sessionAffinity
          });
        })();

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

    const result = streamText({
      model,
      system: systemPrompt,
      messages: pruneMessages({
        messages: await convertToModelMessages(preparedMessages),
        toolCalls: "before-last-2-messages",
        reasoning: "before-last-message"
      }),
      tools,
      stopWhen: stepCountIs(4),
      abortSignal: options?.abortSignal,
      onFinish: ({ text }) => {
        const scan = scanForCommands(text);
        if (scan.hit) {
          this.setState({
            ...this.state,
            counters: {
              ...this.state.counters,
              violations: this.state.counters.violations + 1
            }
          });
        }
      }
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

    const url = new URL(request.url);
    if (url.pathname === "/sitemap.xml") {
      return new Response(generateSitemap("https://stepfix.workers.dev"), {
        headers: { "content-type": "application/xml" }
      });
    }

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
