import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";

interface PromptMessage {
  role: string;
  content: Array<{ type: string; text?: string }>;
}

function extractLastUserText(prompt: unknown): string {
  if (!Array.isArray(prompt)) return "";
  for (let i = (prompt as PromptMessage[]).length - 1; i >= 0; i--) {
    const msg = (prompt as PromptMessage[])[i];
    if (msg.role === "user") {
      for (const part of msg.content) {
        if (part.type === "text" && part.text) return part.text;
      }
    }
  }
  return "";
}

function isOffTopic(text: string): boolean {
  const off =
    /billing|refund|payment|order|cancel subscription|account|password reset|login|email|phone number|address|shipping|delivery|return policy|warranty|invoice|receipt|charge|money back/i;
  return off.test(text);
}

function isSupported(text: string): boolean {
  const supported =
    /bluetooth|wifi|wi-fi|internet|network|disk space|df|command|terminal|path|install|npm|python|node|git|usb|audio|sound|microphone|camera|display|monitor|resolution|package|apt|update|upgrade|service|systemd/i;
  return supported.test(text);
}

function detectOS(text: string): string {
  if (/windows/i.test(text)) return "windows11";
  if (/ubuntu|debian|linux/i.test(text)) return "ubuntu";
  return "unknown";
}

function detectCategory(text: string): string {
  if (/bluetooth|bt|headphone|earbud/i.test(text)) return "bluetooth";
  if (/wifi|wi-fi|internet|network|dns|ping/i.test(text)) return "wifi";
  if (
    /disk|space|df|install|npm|python|node|git|path|command|terminal|package|apt/i.test(
      text
    )
  )
    return "dev_cli";
  return "other";
}

function createStreamResult(
  text: string,
  toolCall?: { toolCallId: string; toolName: string; input: unknown }
): {
  stream: ReadableStream<LanguageModelV4StreamPart>;
} {
  const chunks: LanguageModelV4StreamPart[] = [];
  const textId = "txt-" + Math.random().toString(36).slice(2, 8);

  chunks.push({ type: "text-start", id: textId });
  for (const word of text.split(" ")) {
    chunks.push({ type: "text-delta", id: textId, delta: word + " " });
  }
  chunks.push({ type: "text-end", id: textId });

  if (toolCall) {
    chunks.push({
      type: "tool-input-start",
      id: toolCall.toolCallId,
      toolName: toolCall.toolName
    });
    chunks.push({
      type: "tool-input-delta",
      id: toolCall.toolCallId,
      delta: JSON.stringify(toolCall.input)
    });
    chunks.push({ type: "tool-input-end", id: toolCall.toolCallId });
    chunks.push({
      type: "tool-call",
      toolCallId: toolCall.toolCallId,
      toolName: toolCall.toolName,
      input: JSON.stringify(toolCall.input)
    });
  }

  chunks.push({
    type: "finish",
    finishReason: toolCall
      ? { unified: "tool-calls", raw: "tool-calls" }
      : { unified: "stop", raw: "stop" },
    usage: {
      inputTokens: {
        total: 10,
        noCache: 10,
        cacheRead: undefined,
        cacheWrite: undefined
      },
      outputTokens: { total: 5, text: 5, reasoning: undefined }
    }
  });

  return {
    stream: new ReadableStream({
      async start(controller) {
        await new Promise((r) => setTimeout(r, 200 + Math.random() * 400));
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      }
    })
  };
}

export function createMockModel(options?: {
  cannedText?: string;
  toolCall?: { toolCallId: string; toolName: string; input: unknown };
}): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    provider: "mock",
    modelId: "mock-model",
    doStream: (opts: { prompt?: unknown }) => {
      if (options?.toolCall) {
        return Promise.resolve(
          createStreamResult(
            options.cannedText ?? "Processing.",
            options.toolCall
          )
        );
      }

      const userText = extractLastUserText(opts?.prompt);

      if (isOffTopic(userText)) {
        return Promise.resolve(
          createStreamResult(
            "I'm an AI support agent for computer problems — Bluetooth, Wi-Fi, disk space, and command-line tools on Ubuntu and Windows. I can't help with " +
              userText.slice(0, 60) +
              ". Let me escalate this to a human who can.",
            {
              toolCallId: "call-esc",
              toolName: "escalate_to_human",
              input: {
                reason: "Off-topic request: " + userText.slice(0, 100),
                likelyCause: "Not a technical support issue"
              }
            }
          )
        );
      }

      if (!isSupported(userText)) {
        return Promise.resolve(
          createStreamResult(
            "I'm not sure I can help with that specific issue. I cover Bluetooth, Wi-Fi, disk space, and command-line tools on Ubuntu and Windows. Could you tell me more about what's happening, or would you like me to escalate to a human?",
            {
              toolCallId: "call-esc",
              toolName: "escalate_to_human",
              input: {
                reason: "Unsupported issue: " + userText.slice(0, 100),
                likelyCause: "Outside supported scope"
              }
            }
          )
        );
      }

      const os = detectOS(userText);
      const category = detectCategory(userText);

      const hasCaseInfo = /ubuntu|windows|linux/i.test(userText);

      if (!hasCaseInfo) {
        return Promise.resolve(
          createStreamResult(
            "I can help with that! Are you on Windows or Ubuntu/Linux? And can you tell me what exactly happens when you try?",
            {
              toolCallId: "call-uc",
              toolName: "update_case",
              input: {
                category,
                symptom: userText.slice(0, 200),
                originalTask: userText.slice(0, 200)
              }
            }
          )
        );
      }

      return Promise.resolve(
        createStreamResult(
          `Got it — you're on ${os} with a ${category} issue. Let me note your case and hand you to the Technician.`,
          {
            toolCallId: "call-ho",
            toolName: "handoff_to_technician",
            input: {
              summary: `${os} ${category}: ${userText.slice(0, 150)}`
            }
          }
        )
      );
    }
  });
}
