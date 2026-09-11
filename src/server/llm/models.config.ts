export type Role = "support" | "technician" | "vision" | "embed" | "simulator";
export type Provider = "groq" | "gemini" | "workers-ai" | "zai";

export interface ModelEntry {
  key: string;
  provider: Provider;
  modelId: string;
  roles: Role[];
  caps: { tools: boolean; vision: boolean };
  limits: {
    rpm?: number;
    tpm?: number;
    rpd?: number;
    tpd?: number;
    neuronsPerDay?: number;
  };
  trainsOnInputs: boolean;
  ttftMs: number;
  enabled: boolean;
}

export const ROLE_CHAINS: Record<Role, string[]> = {
  support: [
    "groq:gpt-oss-20b",
    "gemini:flash-lite",
    "workers-ai:glm-4.7-flash",
    "zai:glm-4.7-flash"
  ],
  technician: [
    "gemini:flash",
    "groq:gpt-oss-120b",
    "workers-ai:gpt-oss-120b",
    "zai:glm-4.7-flash"
  ],
  vision: [
    "groq:qwen3.8-27b",
    "groq:qwen3.6-27b",
    "workers-ai:llama-4-scout",
    "gemini:flash",
    "zai:glm-4.6v-flash"
  ],
  embed: ["workers-ai:bge-small-en-v1.5"],
  simulator: ["local:ollama", "groq:gpt-oss-20b"]
};

export const PRIVACY_EXCLUDED_PROVIDERS: Provider[] = ["gemini", "zai"];

export function getModelEntry(
  key: string,
  env: Record<string, string | undefined>
): ModelEntry | undefined {
  return buildRegistry(env).find((e) => e.key === key);
}

export function buildRegistry(
  env: Record<string, string | undefined>
): ModelEntry[] {
  const geminiFlashModel = env.GEMINI_FLASH_MODEL || "gemini-3.8-flash";
  const geminiFlashLiteModel =
    env.GEMINI_FLASH_LITE_MODEL || "gemini-3.5-flash-lite";

  return [
    {
      key: "groq:gpt-oss-20b",
      provider: "groq",
      modelId: "openai/gpt-oss-20b",
      roles: ["support", "technician", "simulator"],
      caps: { tools: true, vision: false },
      limits: { rpm: 30, tpm: 8000, rpd: 1000, tpd: 200000 },
      trainsOnInputs: false,
      ttftMs: 5000,
      enabled: true
    },
    {
      key: "groq:gpt-oss-120b",
      provider: "groq",
      modelId: "openai/gpt-oss-120b",
      roles: ["technician"],
      caps: { tools: true, vision: false },
      limits: { rpm: 30, tpm: 8000, rpd: 1000, tpd: 200000 },
      trainsOnInputs: false,
      ttftMs: 8000,
      enabled: true
    },
    {
      key: "groq:qwen3.8-27b",
      provider: "groq",
      modelId: "qwen/qwen3.8-27b",
      roles: ["vision"],
      caps: { tools: false, vision: true },
      limits: { rpm: 30, tpm: 8000, rpd: 1000, tpd: 200000 },
      trainsOnInputs: false,
      ttftMs: 8000,
      enabled: true
    },
    {
      key: "groq:qwen3.6-27b",
      provider: "groq",
      modelId: "qwen/qwen3.6-27b",
      roles: ["vision"],
      caps: { tools: false, vision: true },
      limits: { rpm: 30, tpm: 8000, rpd: 1000, tpd: 200000 },
      trainsOnInputs: false,
      ttftMs: 8000,
      enabled: true
    },
    {
      key: "gemini:flash",
      provider: "gemini",
      modelId: geminiFlashModel,
      roles: ["technician", "vision"],
      caps: { tools: true, vision: true },
      limits: { rpm: 15, tpm: 250000, rpd: 1500 },
      trainsOnInputs: true,
      ttftMs: 6000,
      enabled: true
    },
    {
      key: "gemini:flash-lite",
      provider: "gemini",
      modelId: geminiFlashLiteModel,
      roles: ["support"],
      caps: { tools: true, vision: false },
      limits: { rpm: 15, tpm: 250000, rpd: 1500 },
      trainsOnInputs: true,
      ttftMs: 4000,
      enabled: true
    },
    {
      key: "workers-ai:glm-4.7-flash",
      provider: "workers-ai",
      modelId: "@cf/zai-org/glm-4.7-flash",
      roles: ["support", "technician"],
      caps: { tools: true, vision: false },
      limits: { neuronsPerDay: 10000 },
      trainsOnInputs: false,
      ttftMs: 5000,
      enabled: true
    },
    {
      key: "workers-ai:gpt-oss-120b",
      provider: "workers-ai",
      modelId: "@cf/openai/gpt-oss-120b",
      roles: ["technician"],
      caps: { tools: true, vision: false },
      limits: { neuronsPerDay: 10000 },
      trainsOnInputs: false,
      ttftMs: 8000,
      enabled: true
    },
    {
      key: "workers-ai:llama-4-scout",
      provider: "workers-ai",
      modelId: "@cf/meta/llama-4-scout-17b-16e-instruct",
      roles: ["vision"],
      caps: { tools: true, vision: true },
      limits: { neuronsPerDay: 10000 },
      trainsOnInputs: false,
      ttftMs: 10000,
      enabled: true
    },
    {
      key: "workers-ai:bge-small-en-v1.5",
      provider: "workers-ai",
      modelId: "@cf/baai/bge-small-en-v1.5",
      roles: ["embed"],
      caps: { tools: false, vision: false },
      limits: { neuronsPerDay: 10000 },
      trainsOnInputs: false,
      ttftMs: 3000,
      enabled: true
    },
    {
      key: "zai:glm-4.7-flash",
      provider: "zai",
      modelId: "glm-4.7-flash",
      roles: ["support", "technician"],
      caps: { tools: true, vision: false },
      limits: { rpd: 1000 },
      trainsOnInputs: false,
      ttftMs: 6000,
      enabled: true
    },
    {
      key: "zai:glm-4.6v-flash",
      provider: "zai",
      modelId: "glm-4.6v-flash",
      roles: ["vision"],
      caps: { tools: false, vision: true },
      limits: { rpd: 1000 },
      trainsOnInputs: false,
      ttftMs: 8000,
      enabled: true
    }
  ];
}

export function getRoleChain(role: Role, privacyMode: boolean): string[] {
  const chain = ROLE_CHAINS[role] ?? [];
  if (!privacyMode) return chain;
  return chain.filter((key) => {
    const provider = key.split(":")[0] as Provider;
    return !PRIVACY_EXCLUDED_PROVIDERS.includes(provider);
  });
}
