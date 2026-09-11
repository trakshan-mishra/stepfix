import { buildRegistry } from "../llm/models.config";
import type { ModelQuota, KillSwitches } from "../agents/coordinator-logic";

interface CoordinatorRPC {
  getAllQuotas(): Promise<Record<string, ModelQuota>>;
  getKillSwitches(): Promise<KillSwitches>;
  disableProvider(provider: string): Promise<void>;
  enableProvider(provider: string): Promise<void>;
  disableModel(key: string): Promise<void>;
  enableModel(key: string): Promise<void>;
  forceDegraded(value: boolean): Promise<void>;
}

async function getCoordinator(env: Env): Promise<CoordinatorRPC> {
  const id = env.Coordinator.idFromName("global");
  return env.Coordinator.get(id) as unknown as CoordinatorRPC;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

export async function handleAdminRequest(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/admin")) return null;

  const adminToken = env.ADMIN_TOKEN;
  if (!adminToken) return json({ error: "admin not configured" }, 503);

  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/, "");
  if (token !== adminToken) return json({ error: "unauthorized" }, 401);

  const coordinator = await getCoordinator(env);
  const registry = buildRegistry(
    env as unknown as Record<string, string | undefined>
  );

  if (url.pathname === "/api/admin/health" && request.method === "GET") {
    const quotas = await coordinator.getAllQuotas();
    const killSwitches = await coordinator.getKillSwitches();

    const providers: Record<string, string> = {};
    for (const entry of registry) {
      const status = killSwitches.disabledProviders.includes(entry.provider)
        ? "off"
        : killSwitches.disabledModels.includes(entry.key)
          ? "off"
          : (quotas[entry.key]?.disabled ?? false)
            ? "off"
            : quotas[entry.key]?.cooldownUntil &&
                quotas[entry.key].cooldownUntil > Date.now()
              ? "cooling"
              : "ok";
      providers[entry.key] = status;
    }

    return json({
      providers,
      degraded: killSwitches.forceDegraded,
      admissionsPaused: killSwitches.admissionsPaused,
      killSwitches
    });
  }

  if (url.pathname === "/api/admin/kill-switch" && request.method === "POST") {
    const body = (await request.json()) as {
      action?: string;
      provider?: string;
      model?: string;
      forceDegraded?: boolean;
    };

    if (body.action === "disable-provider" && body.provider) {
      await coordinator.disableProvider(body.provider);
    } else if (body.action === "enable-provider" && body.provider) {
      await coordinator.enableProvider(body.provider);
    } else if (body.action === "disable-model" && body.model) {
      await coordinator.disableModel(body.model);
    } else if (body.action === "enable-model" && body.model) {
      await coordinator.enableModel(body.model);
    } else if (body.action === "force-degraded") {
      await coordinator.forceDegraded(body.forceDegraded ?? true);
    } else {
      return json({ error: "unknown action" }, 400);
    }

    return json({ ok: true });
  }

  return json({ error: "not found" }, 404);
}
