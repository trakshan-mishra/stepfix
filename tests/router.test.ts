import { describe, it, expect } from "vitest";
import { classify } from "../src/server/llm/classify";
import {
  parseChaos,
  effectiveChaos,
  shouldChaos,
  type ChaosFlags
} from "../src/server/llm/chaos";
import {
  buildRegistry,
  getRoleChain,
  isActionable,
  resolveEntry,
  getActionableCandidates,
  PRIVACY_EXCLUDED_PROVIDERS,
  type Role
} from "../src/server/llm/models.config";

const env: Record<string, string | undefined> = {
  GEMINI_FLASH_MODEL: "gemini-3.8-flash",
  GEMINI_FLASH_LITE_MODEL: "gemini-3.5-flash-lite"
};

describe("classify", () => {
  it("classifies 429 as rate_limit with 60s default cooldown", () => {
    const ec = classify(new Error("429 Too Many Requests"));
    expect(ec.kind).toBe("rate_limit");
    if (ec.kind === "rate_limit") expect(ec.cooldownMs).toBe(60_000);
  });

  it("classifies rate limit with retry-after", () => {
    const ec = classify(new Error("429 retry-after: 20"));
    expect(ec.kind).toBe("rate_limit");
    if (ec.kind === "rate_limit") {
      expect(ec.retryAfterSec).toBe(20);
      expect(ec.cooldownMs).toBe(20_000);
    }
  });

  it("classifies 401 as auth_error", () => {
    const ec = classify(new Error("401 Unauthorized"));
    expect(ec.kind).toBe("auth_error");
  });

  it("classifies 403 as auth_error", () => {
    const ec = classify(new Error("403 Forbidden"));
    expect(ec.kind).toBe("auth_error");
  });

  it("classifies 404 as not_found", () => {
    const ec = classify(new Error("404 model not found"));
    expect(ec.kind).toBe("not_found");
  });

  it("classifies 500 as server_error with 30s cooldown", () => {
    const ec = classify(new Error("500 Internal Server Error"));
    expect(ec.kind).toBe("server_error");
    if (ec.kind === "server_error") expect(ec.cooldownMs).toBe(30_000);
  });

  it("classifies 503 as server_error", () => {
    const ec = classify(new Error("503 Service Unavailable"));
    expect(ec.kind).toBe("server_error");
  });

  it("classifies timeout with 20s cooldown", () => {
    const ec = classify(new Error("timeout: aborted"));
    expect(ec.kind).toBe("timeout");
    if (ec.kind === "timeout") expect(ec.cooldownMs).toBe(20_000);
  });

  it("classifies network error with 30s cooldown", () => {
    const ec = classify(new Error("fetch failed: ECONNRESET"));
    expect(ec.kind).toBe("network_error");
    if (ec.kind === "network_error") expect(ec.cooldownMs).toBe(30_000);
  });

  it("classifies unknown error with 30s cooldown", () => {
    const ec = classify(new Error("something weird happened"));
    expect(ec.kind).toBe("unknown");
    if (ec.kind === "unknown") expect(ec.cooldownMs).toBe(30_000);
  });
});

describe("chaos parsing", () => {
  it("parses empty string as all zeros", () => {
    const flags = parseChaos("");
    expect(flags["429"]).toBe(0);
    expect(flags.timeout).toBe(0);
    expect(flags.cut).toBe(0);
    expect(flags.all_down).toBe(0);
  });

  it("parses 429:0.3", () => {
    const flags = parseChaos("429:0.3");
    expect(flags["429"]).toBeCloseTo(0.3);
  });

  it("parses multiple flags", () => {
    const flags = parseChaos("429:0.3,timeout:0.1,cut:0.1");
    expect(flags["429"]).toBeCloseTo(0.3);
    expect(flags.timeout).toBeCloseTo(0.1);
    expect(flags.cut).toBeCloseTo(0.1);
  });

  it("parses all_down:1", () => {
    const flags = parseChaos("all_down:1");
    expect(flags.all_down).toBe(1);
  });

  it("parses vectorize_down and d1_down", () => {
    const flags = parseChaos("vectorize_down:1,d1_down:0.2");
    expect(flags.vectorize_down).toBe(1);
    expect(flags.d1_down).toBeCloseTo(0.2);
  });

  it("ignores invalid entries", () => {
    const flags = parseChaos("garbage,bad:abc,429:0.5");
    expect(flags["429"]).toBeCloseTo(0.5);
  });

  it("returns all zeros in production", () => {
    const flags = effectiveChaos("429:0.5,all_down:1", "production");
    expect(flags["429"]).toBe(0);
    expect(flags.all_down).toBe(0);
  });

  it("returns flags in development", () => {
    const flags = effectiveChaos("429:0.5,all_down:1", "development");
    expect(flags["429"]).toBeCloseTo(0.5);
    expect(flags.all_down).toBe(1);
  });

  it("shouldChaos returns false when prob is 0", () => {
    const flags: ChaosFlags = {
      "429": 0,
      timeout: 0,
      cut: 0,
      all_down: 0,
      vectorize_down: 0,
      d1_down: 0
    };
    expect(shouldChaos(flags, "429")).toBe(false);
  });

  it("shouldChaos returns true when prob is 1", () => {
    const flags: ChaosFlags = {
      "429": 1,
      timeout: 0,
      cut: 0,
      all_down: 0,
      vectorize_down: 0,
      d1_down: 0
    };
    expect(shouldChaos(flags, "429")).toBe(true);
  });
});

describe("privacy mode filtering", () => {
  it("removes gemini and zai from chain when privacy mode is on", () => {
    const chain = getRoleChain("support", true);
    for (const key of chain) {
      const provider = key.split(":")[0];
      expect(PRIVACY_EXCLUDED_PROVIDERS).not.toContain(provider);
    }
  });

  it("keeps gemini and zai when privacy mode is off", () => {
    const chain = getRoleChain("support", false);
    expect(chain.some((k) => k.startsWith("gemini:"))).toBe(true);
    expect(chain.some((k) => k.startsWith("zai:"))).toBe(true);
  });

  it("removes gemini from technician chain in privacy mode", () => {
    const chain = getRoleChain("technician", true);
    expect(chain.some((k) => k.startsWith("gemini:"))).toBe(false);
    expect(chain.some((k) => k.startsWith("zai:"))).toBe(false);
    expect(chain.some((k) => k.startsWith("groq:"))).toBe(true);
  });

  it("removes gemini from vision chain in privacy mode", () => {
    const chain = getRoleChain("vision", true);
    expect(chain.some((k) => k.startsWith("gemini:"))).toBe(false);
    expect(chain.some((k) => k.startsWith("zai:"))).toBe(false);
  });
});

describe("model registry", () => {
  it("has 12 entries", () => {
    const registry = buildRegistry(env);
    expect(registry.length).toBe(12);
  });

  it("all keys are unique", () => {
    const registry = buildRegistry(env);
    const keys = registry.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("all entries default to disabled (unverified) except activated CF GLM", () => {
    const registry = buildRegistry(env);
    for (const entry of registry) {
      if (entry.key === "workers-ai:glm-4.7-flash") {
        expect(isActionable(entry)).toBe(true);
      } else {
        expect(isActionable(entry)).toBe(false);
      }
    }
  });

  it("every unverified entry resolves to disabled", () => {
    const registry = buildRegistry(env);
    for (const entry of registry) {
      if (entry.key === "workers-ai:glm-4.7-flash") {
        expect(resolveEntry(entry.key, env)).toBeDefined();
      } else {
        expect(resolveEntry(entry.key, env)).toBeUndefined();
      }
    }
  });

  it("a key alone does not activate a model (except user-activated CF GLM)", () => {
    const registry = buildRegistry(env);
    for (const entry of registry) {
      if (entry.key === "workers-ai:glm-4.7-flash") continue;
      expect(entry.runtimeEnabled).toBe(false);
      expect(entry.accountVerified).toBe(false);
      expect(entry.freeEligibilityVerified).toBe(false);
      expect(entry.privacyConfigVerified).toBe(false);
      expect(entry.effectiveLimits).toBe(null);
    }
  });

  it("privacy mode is not the only gate disabling gemini/zai", () => {
    const registry = buildRegistry(env);
    const geminiAndZai = registry.filter(
      (e) => e.provider === "gemini" || e.provider === "zai"
    );
    for (const entry of geminiAndZai) {
      expect(isActionable(entry)).toBe(false);
    }
  });

  it("gemini has no guessed limits (empty reference limits)", () => {
    const registry = buildRegistry(env);
    const gemini = registry.filter((e) => e.provider === "gemini");
    for (const e of gemini) {
      expect(e.limits.rpd).toBeUndefined();
      expect(e.limits.tpm).toBeUndefined();
    }
  });

  it("zai has no guessed limits", () => {
    const registry = buildRegistry(env);
    const zai = registry.filter((e) => e.provider === "zai");
    for (const e of zai) {
      expect(e.limits.rpd).toBeUndefined();
    }
  });

  it("cf neurons are account-shared (no per-model neuronsPerDay)", () => {
    const registry = buildRegistry(env);
    const cf = registry.filter((e) => e.provider === "workers-ai");
    for (const e of cf) {
      expect(e.limits).toEqual({});
      expect(e.quotaGroup).toBe("cf-account-neurons");
    }
  });

  it("cf glm-4.7-flash has neuron rate for estimation", () => {
    const registry = buildRegistry(env);
    const glm = registry.find((e) => e.key === "workers-ai:glm-4.7-flash");
    expect(glm?.neuronRate).toEqual({
      inputPerMillion: 5500,
      outputPerMillion: 36400
    });
  });

  it("groq has reference limits with rpm/tpm/rpd/tpd", () => {
    const registry = buildRegistry(env);
    const groqText = registry.find((e) => e.key === "groq:gpt-oss-20b");
    expect(groqText?.limits.rpm).toBe(30);
    expect(groqText?.limits.tpm).toBe(8000);
    expect(groqText?.limits.rpd).toBe(1000);
    expect(groqText?.limits.tpd).toBe(200000);
  });

  it("supports itpm/otpm split in limits type", () => {
    const registry = buildRegistry(env);
    const entry = registry[0];
    expect(entry.limits.itpm).toBeUndefined();
    expect(entry.limits.otpm).toBeUndefined();
  });

  it("getActionableCandidates returns only activated CF GLM", () => {
    const candidates = getActionableCandidates("support", false, env);
    expect(candidates.length).toBe(1);
    expect(candidates[0].key).toBe("workers-ai:glm-4.7-flash");
  });

  it("gemini models use env var model IDs", () => {
    const registry = buildRegistry({
      ...env,
      GEMINI_FLASH_MODEL: "custom-flash",
      GEMINI_FLASH_LITE_MODEL: "custom-flash-lite"
    });
    const flash = registry.find((e) => e.key === "gemini:flash");
    const lite = registry.find((e) => e.key === "gemini:flash-lite");
    expect(flash?.modelId).toBe("custom-flash");
    expect(lite?.modelId).toBe("custom-flash-lite");
  });

  it("gemini models have default IDs when env not set", () => {
    const registry = buildRegistry({});
    const flash = registry.find((e) => e.key === "gemini:flash");
    expect(flash?.modelId).toContain("flash");
  });

  it("groq does not train on inputs", () => {
    const registry = buildRegistry(env);
    const groq = registry.filter((e) => e.provider === "groq");
    for (const e of groq) expect(e.trainsOnInputs).toBe(false);
  });

  it("gemini trains on inputs", () => {
    const registry = buildRegistry(env);
    const gemini = registry.filter((e) => e.provider === "gemini");
    for (const e of gemini) expect(e.trainsOnInputs).toBe(true);
  });
});

describe("coordinator quota ledger", () => {
  it("report ok clears consecutive failures", async () => {
    const { CoordinatorLogic, createCoordinatorData } =
      await import("../src/server/agents/coordinator-logic");
    const c = new CoordinatorLogic(createCoordinatorData());
    c.report("groq:gpt-oss-20b", {
      ok: false,
      errorClass: classify(new Error("500 error"))
    });
    expect(c.getQuota("groq:gpt-oss-20b")?.consecutiveFailures).toBe(1);
    c.report("groq:gpt-oss-20b", { ok: true });
    expect(c.getQuota("groq:gpt-oss-20b")?.consecutiveFailures).toBe(0);
  });

  it("disables model on auth error", async () => {
    const { CoordinatorLogic, createCoordinatorData } =
      await import("../src/server/agents/coordinator-logic");
    const c = new CoordinatorLogic(createCoordinatorData());
    c.report("groq:gpt-oss-20b", {
      ok: false,
      errorClass: classify(new Error("401 Unauthorized"))
    });
    expect(c.isCooling("groq:gpt-oss-20b")).toBe(true);
  });

  it("sets cooldown on rate limit", async () => {
    const { CoordinatorLogic, createCoordinatorData } =
      await import("../src/server/agents/coordinator-logic");
    const c = new CoordinatorLogic(createCoordinatorData());
    c.report("groq:gpt-oss-20b", {
      ok: false,
      errorClass: classify(new Error("429 Too Many Requests"))
    });
    expect(c.isCooling("groq:gpt-oss-20b")).toBe(true);
  });

  it("opens circuit after 3 consecutive failures", async () => {
    const { CoordinatorLogic, createCoordinatorData } =
      await import("../src/server/agents/coordinator-logic");
    const c = new CoordinatorLogic(createCoordinatorData());
    for (let i = 0; i < 3; i++) {
      c.report("groq:gpt-oss-20b", {
        ok: false,
        errorClass: classify(new Error("500 error"))
      });
    }
    expect(c.isCooling("groq:gpt-oss-20b")).toBe(true);
    const quota = c.getQuota("groq:gpt-oss-20b");
    expect(quota?.cooldownUntil).toBeGreaterThan(Date.now() + 60_000);
  });

  it("candidates filters cooling models", async () => {
    const { CoordinatorLogic, createCoordinatorData } =
      await import("../src/server/agents/coordinator-logic");
    const c = new CoordinatorLogic(createCoordinatorData());
    const keys = ["groq:gpt-oss-20b", "gemini:flash-lite"];
    expect(c.candidates(keys)).toEqual(keys);
    c.report("groq:gpt-oss-20b", {
      ok: false,
      errorClass: classify(new Error("429"))
    });
    expect(c.candidates(keys)).toEqual(["gemini:flash-lite"]);
  });

  it("candidates returns empty when forceDegraded", async () => {
    const { CoordinatorLogic, createCoordinatorData } =
      await import("../src/server/agents/coordinator-logic");
    const c = new CoordinatorLogic(createCoordinatorData());
    c.forceDegraded(true);
    expect(c.candidates(["groq:gpt-oss-20b"])).toEqual([]);
  });

  it("kill switch disables provider", async () => {
    const { CoordinatorLogic, createCoordinatorData } =
      await import("../src/server/agents/coordinator-logic");
    const c = new CoordinatorLogic(createCoordinatorData());
    c.disableProvider("groq");
    expect(c.isCooling("groq:gpt-oss-20b")).toBe(true);
    expect(c.isCooling("groq:gpt-oss-120b")).toBe(true);
    c.enableProvider("groq");
    expect(c.isCooling("groq:gpt-oss-20b")).toBe(false);
  });

  it("kill switch disables individual model", async () => {
    const { CoordinatorLogic, createCoordinatorData } =
      await import("../src/server/agents/coordinator-logic");
    const c = new CoordinatorLogic(createCoordinatorData());
    c.disableModel("groq:gpt-oss-20b");
    expect(c.isCooling("groq:gpt-oss-20b")).toBe(true);
    expect(c.isCooling("groq:gpt-oss-120b")).toBe(false);
    c.enableModel("groq:gpt-oss-20b");
    expect(c.isCooling("groq:gpt-oss-20b")).toBe(false);
  });
});
