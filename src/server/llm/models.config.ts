export type Role = "support" | "technician" | "vision" | "embed" | "simulator";
export type Provider = "groq" | "gemini" | "workers-ai" | "zai";

export interface ReferenceLimits {
  rpm?: number;
  tpm?: number;
  itpm?: number;
  otpm?: number;
  rpd?: number;
  tpd?: number;
  audioSecondsPerHour?: number;
  audioSecondsPerDay?: number;
  neuronsPerDay?: number;
}

export type EffectiveLimits = ReferenceLimits;

export interface NeuronRate {
  inputPerMillion: number;
  outputPerMillion: number;
}

export interface ModelEntry {
  key: string;
  provider: Provider;
  modelId: string;
  roles: Role[];
  caps: { tools: boolean; vision: boolean };
  quotaGroup: string;
  limits: ReferenceLimits;
  effectiveLimits: EffectiveLimits | null;
  neuronRate?: NeuronRate;
  accountVerified: boolean;
  runtimeEnabled: boolean;
  freeEligibilityVerified: boolean;
  privacyConfigVerified: boolean;
  trainsOnInputs: boolean;
  ttftMs: number;
  paid: boolean;
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

export const CF_NEURONS_PER_DAY = 10000;

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
      quotaGroup: "groq-org-text",
      limits: { rpm: 30, tpm: 8000, rpd: 1000, tpd: 200000 },
      effectiveLimits: null,
      accountVerified: false,
      runtimeEnabled: false,
      freeEligibilityVerified: false,
      privacyConfigVerified: false,
      trainsOnInputs: false,
      ttftMs: 5000,
      paid: false
    },
    {
      key: "groq:gpt-oss-120b",
      provider: "groq",
      modelId: "openai/gpt-oss-120b",
      roles: ["technician"],
      caps: { tools: true, vision: false },
      quotaGroup: "groq-org-text",
      limits: { rpm: 30, tpm: 8000, rpd: 1000, tpd: 200000 },
      effectiveLimits: null,
      accountVerified: false,
      runtimeEnabled: false,
      freeEligibilityVerified: false,
      privacyConfigVerified: false,
      trainsOnInputs: false,
      ttftMs: 8000,
      paid: false
    },
    {
      key: "groq:qwen3.8-27b",
      provider: "groq",
      modelId: "qwen/qwen3.8-27b",
      roles: ["vision"],
      caps: { tools: false, vision: true },
      quotaGroup: "groq-org-vlm",
      limits: { rpm: 30, tpm: 8000, rpd: 1000, tpd: 200000 },
      effectiveLimits: null,
      accountVerified: false,
      runtimeEnabled: false,
      freeEligibilityVerified: false,
      privacyConfigVerified: false,
      trainsOnInputs: false,
      ttftMs: 8000,
      paid: false
    },
    {
      key: "groq:qwen3.6-27b",
      provider: "groq",
      modelId: "qwen/qwen3.6-27b",
      roles: ["vision"],
      caps: { tools: false, vision: true },
      quotaGroup: "groq-org-vlm",
      limits: { rpm: 30, tpm: 8000, rpd: 1000, tpd: 200000 },
      effectiveLimits: null,
      accountVerified: false,
      runtimeEnabled: false,
      freeEligibilityVerified: false,
      privacyConfigVerified: false,
      trainsOnInputs: false,
      ttftMs: 8000,
      paid: false
    },
    {
      key: "gemini:flash",
      provider: "gemini",
      modelId: geminiFlashModel,
      roles: ["technician", "vision"],
      caps: { tools: true, vision: true },
      quotaGroup: "gemini-project",
      limits: {},
      effectiveLimits: null,
      accountVerified: false,
      runtimeEnabled: false,
      freeEligibilityVerified: false,
      privacyConfigVerified: false,
      trainsOnInputs: true,
      ttftMs: 6000,
      paid: false
    },
    {
      key: "gemini:flash-lite",
      provider: "gemini",
      modelId: geminiFlashLiteModel,
      roles: ["support"],
      caps: { tools: true, vision: false },
      quotaGroup: "gemini-project",
      limits: {},
      effectiveLimits: null,
      accountVerified: false,
      runtimeEnabled: false,
      freeEligibilityVerified: false,
      privacyConfigVerified: false,
      trainsOnInputs: true,
      ttftMs: 4000,
      paid: false
    },
    {
      key: "workers-ai:glm-4.7-flash",
      provider: "workers-ai",
      modelId: "@cf/zai-org/glm-4.7-flash",
      roles: ["support", "technician"],
      caps: { tools: true, vision: false },
      quotaGroup: "cf-account-neurons",
      limits: {},
      effectiveLimits: { neuronsPerDay: 10000 },
      neuronRate: { inputPerMillion: 5500, outputPerMillion: 36400 },
      accountVerified: true,
      runtimeEnabled: true,
      freeEligibilityVerified: true,
      privacyConfigVerified: true,
      trainsOnInputs: false,
      ttftMs: 5000,
      paid: false
    },
    {
      key: "workers-ai:gpt-oss-120b",
      provider: "workers-ai",
      modelId: "@cf/openai/gpt-oss-120b",
      roles: ["technician"],
      caps: { tools: true, vision: false },
      quotaGroup: "cf-account-neurons",
      limits: {},
      effectiveLimits: null,
      accountVerified: false,
      runtimeEnabled: false,
      freeEligibilityVerified: false,
      privacyConfigVerified: false,
      trainsOnInputs: false,
      ttftMs: 8000,
      paid: false
    },
    {
      key: "workers-ai:llama-4-scout",
      provider: "workers-ai",
      modelId: "@cf/meta/llama-4-scout-17b-16e-instruct",
      roles: ["vision"],
      caps: { tools: true, vision: true },
      quotaGroup: "cf-account-neurons",
      limits: {},
      effectiveLimits: null,
      accountVerified: false,
      runtimeEnabled: false,
      freeEligibilityVerified: false,
      privacyConfigVerified: false,
      trainsOnInputs: false,
      ttftMs: 10000,
      paid: false
    },
    {
      key: "workers-ai:bge-small-en-v1.5",
      provider: "workers-ai",
      modelId: "@cf/baai/bge-small-en-v1.5",
      roles: ["embed"],
      caps: { tools: false, vision: false },
      quotaGroup: "cf-account-neurons",
      limits: {},
      effectiveLimits: null,
      accountVerified: false,
      runtimeEnabled: false,
      freeEligibilityVerified: false,
      privacyConfigVerified: false,
      trainsOnInputs: false,
      ttftMs: 3000,
      paid: false
    },
    {
      key: "zai:glm-4.7-flash",
      provider: "zai",
      modelId: "glm-4.7-flash",
      roles: ["support", "technician"],
      caps: { tools: true, vision: false },
      quotaGroup: "zai-org",
      limits: {},
      effectiveLimits: null,
      accountVerified: false,
      runtimeEnabled: false,
      freeEligibilityVerified: false,
      privacyConfigVerified: false,
      trainsOnInputs: false,
      ttftMs: 6000,
      paid: false
    },
    {
      key: "zai:glm-4.6v-flash",
      provider: "zai",
      modelId: "glm-4.6v-flash",
      roles: ["vision"],
      caps: { tools: false, vision: true },
      quotaGroup: "zai-org",
      limits: {},
      effectiveLimits: null,
      accountVerified: false,
      runtimeEnabled: false,
      freeEligibilityVerified: false,
      privacyConfigVerified: false,
      trainsOnInputs: false,
      ttftMs: 8000,
      paid: false
    }
  ];
}

export function isActionable(entry: ModelEntry): boolean {
  if (entry.paid) return false;
  if (!entry.runtimeEnabled) return false;
  if (!entry.accountVerified) return false;
  if (!entry.freeEligibilityVerified) return false;
  if (!entry.privacyConfigVerified) return false;
  return true;
}

export function resolveEntry(
  key: string,
  env: Record<string, string | undefined>
): ModelEntry | undefined {
  const entry = getModelEntry(key, env);
  if (!entry) return undefined;
  if (!isActionable(entry)) return undefined;
  return entry;
}

export function getRoleChain(role: Role, privacyMode: boolean): string[] {
  const chain = ROLE_CHAINS[role] ?? [];
  if (!privacyMode) return chain;
  return chain.filter((key) => {
    const provider = key.split(":")[0] as Provider;
    return !PRIVACY_EXCLUDED_PROVIDERS.includes(provider);
  });
}

export function getActionableCandidates(
  role: Role,
  privacyMode: boolean,
  env: Record<string, string | undefined>
): ModelEntry[] {
  const chain = getRoleChain(role, privacyMode);
  const registry = buildRegistry(env);
  return chain
    .map((key) => registry.find((e) => e.key === key))
    .filter((e): e is ModelEntry => e !== undefined)
    .filter(isActionable);
}
