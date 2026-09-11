import { Agent, routeAgentRequest } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import {
  convertToModelMessages,
  pruneMessages,
  stepCountIs,
  streamText
} from "ai";
import { createWorkersAI } from "workers-ai-provider";
import { handleLibraryRequest } from "./server/http/library";

export class SupportSession extends AIChatAgent<Env> {
  maxPersistedMessages = 200;

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const workersai = createWorkersAI({ binding: this.env.AI });

    const result = streamText({
      model: workersai("@cf/moonshotai/kimi-k2.7-code", {
        sessionAffinity: this.sessionAffinity
      }),
      system:
        "You are stepfix, an AI support agent. You help users fix their own computer problems on Linux (Ubuntu/Debian) and Windows 10/11. Be concise and friendly.",
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
}

export class Coordinator extends Agent<Env> {
  onStart() {
    // TODO M2: admission queue, quota ledger, kill switches
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const libraryResponse = handleLibraryRequest(request);
    if (libraryResponse) return libraryResponse;

    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
