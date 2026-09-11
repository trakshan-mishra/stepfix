import { createGroq } from "@ai-sdk/groq";
import { createGoogle } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createWorkersAI } from "workers-ai-provider";
import type { ModelEntry, Provider } from "./models.config";
import type { LanguageModelV4 } from "@ai-sdk/provider";

type ModelFactory = (
  entry: ModelEntry,
  env: Record<string, string | undefined>,
  aiBinding?: Ai
) => LanguageModelV4;

const factories: Partial<Record<Provider, ModelFactory>> = {
  groq: (entry, env) => {
    const groq = createGroq({ apiKey: env.GROQ_API_KEY });
    return groq(entry.modelId) as unknown as LanguageModelV4;
  },
  gemini: (entry, env) => {
    const google = createGoogle({ apiKey: env.GEMINI_API_KEY });
    return google(entry.modelId) as unknown as LanguageModelV4;
  },
  "workers-ai": (entry, _env, aiBinding) => {
    if (!aiBinding) throw new Error("Workers AI binding not available");
    const workersai = createWorkersAI({ binding: aiBinding });
    return workersai(entry.modelId) as unknown as LanguageModelV4;
  },
  zai: (entry, env) => {
    const baseURL = env.ZAI_BASE_URL || "https://api.z.ai/api/paas/v4";
    const zai = createOpenAICompatible({
      baseURL,
      name: "zai",
      apiKey: env.ZAI_API_KEY
    });
    return zai(entry.modelId) as unknown as LanguageModelV4;
  }
};

export function getModel(
  entry: ModelEntry,
  env: Record<string, string | undefined>,
  aiBinding?: Ai
): LanguageModelV4 {
  const factory = factories[entry.provider];
  if (!factory) throw new Error(`No factory for provider "${entry.provider}"`);
  return factory(entry, env, aiBinding);
}
