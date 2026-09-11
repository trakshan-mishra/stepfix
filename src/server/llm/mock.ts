import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";

function createMockStreamResult(
  text: string,
  options?: {
    toolCall?: { toolCallId: string; toolName: string; input: unknown };
  }
): {
  stream: ReadableStream<LanguageModelV4StreamPart>;
  response?: { headers?: Record<string, string> };
} {
  const words = text.split(" ");
  const chunks: LanguageModelV4StreamPart[] = [];
  const textId = "txt-" + Math.random().toString(36).slice(2, 8);

  for (const word of words) {
    chunks.push({ type: "text-start", id: textId });
    chunks.push({ type: "text-delta", id: textId, delta: word + " " });
    chunks.push({ type: "text-end", id: textId });
  }

  if (options?.toolCall) {
    chunks.push({
      type: "tool-input-start",
      id: options.toolCall.toolCallId,
      toolName: options.toolCall.toolName
    });
    chunks.push({
      type: "tool-input-delta",
      id: options.toolCall.toolCallId,
      delta: JSON.stringify(options.toolCall.input)
    });
    chunks.push({ type: "tool-input-end", id: options.toolCall.toolCallId });
    chunks.push({
      type: "tool-call",
      toolCallId: options.toolCall.toolCallId,
      toolName: options.toolCall.toolName,
      input: JSON.stringify(options.toolCall.input)
    });
  }

  chunks.push({
    type: "finish",
    finishReason: { unified: "stop", raw: "stop" },
    usage: {
      inputTokens: {
        total: 10,
        noCache: 10,
        cacheRead: undefined,
        cacheWrite: undefined
      },
      outputTokens: {
        total: words.length,
        text: words.length,
        reasoning: undefined
      }
    }
  });

  return {
    stream: new ReadableStream({
      async start(controller) {
        const delay = 300 + Math.random() * 1200;
        await new Promise((r) => setTimeout(r, delay));
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      }
    })
  };
}

export function createMockModel(options?: {
  cannedText?: string;
  toolCall?: { toolCallId: string; toolName: string; input: unknown };
}): MockLanguageModelV4 {
  const cannedText =
    options?.cannedText ??
    "Hello! I'm the stepfix support agent. I can help you fix problems with Bluetooth, Wi-Fi, and command-line tools on Linux and Windows. What seems to be going wrong?";

  return new MockLanguageModelV4({
    provider: "mock",
    modelId: "mock-model",
    doStream: () =>
      Promise.resolve(
        createMockStreamResult(
          cannedText,
          options?.toolCall ? { toolCall: options.toolCall } : undefined
        )
      )
  });
}
