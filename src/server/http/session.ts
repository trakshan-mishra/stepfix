import { nanoid } from "nanoid";
import { signToken, verifyToken, revokeToken, isRevoked } from "./token";
import { verifyTurnstile } from "./turnstile";
import type { Coordinator } from "../agents/coordinator";

type CoordinatorStub = DurableObjectStub<Coordinator>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

async function getCoordinator(env: Env): Promise<CoordinatorStub> {
  const id = env.Coordinator.idFromName("global");
  return env.Coordinator.get(id) as unknown as CoordinatorStub;
}

function hashIp(ip: string, secret: string): string {
  return btoa(ip + secret).slice(0, 32);
}

export async function handleSessionRequest(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/api/session" && request.method === "POST") {
    return createSession(request, env);
  }

  if (path.startsWith("/api/session/queue/") && request.method === "GET") {
    return checkQueue(request, env, url);
  }

  if (path.startsWith("/api/session/") && request.method === "DELETE") {
    return deleteSession(request, env, url);
  }

  return null;
}

async function createSession(request: Request, env: Env): Promise<Response> {
  let body: { turnstileToken?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid body" }, 400);
  }

  if (!body.turnstileToken) {
    return json({ error: "turnstile required" }, 403);
  }

  const ts = await verifyTurnstile(
    body.turnstileToken,
    env.TURNSTILE_SECRET_KEY
  );
  if (!ts.ok) {
    return json({ error: "turnstile failed", detail: ts.error }, 403);
  }

  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const signingKey = env.SESSION_SIGNING_KEY ?? "dev-key-change-me";
  const ipHash = hashIp(ip, signingKey);

  const coordinator = await getCoordinator(env);
  const sessionId = nanoid(21);
  const result = await coordinator.admit(
    { ipHash },
    sessionId,
    env.MAX_ACTIVE_SESSIONS ? parseInt(env.MAX_ACTIVE_SESSIONS, 10) : undefined
  );

  if (result.status === "rejected") {
    return json({ status: "rejected", reason: result.reason }, 503);
  }

  if (result.status === "queued") {
    return json(
      {
        status: "queued",
        ticket: result.ticket,
        position: result.position,
        retryAfterSec: result.retryAfterSec
      },
      202
    );
  }

  const token = await signToken(result.sessionId, signingKey);
  return json({ status: "admitted", sessionId: result.sessionId, token });
}

async function checkQueue(
  _request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  const ticket = url.pathname.split("/").pop() ?? "";
  const coordinator = await getCoordinator(env);
  const result = await coordinator.checkQueue(ticket);

  if (result.status === "admitted" && result.sessionId) {
    const signingKey = env.SESSION_SIGNING_KEY ?? "dev-key-change-me";
    const token = await signToken(result.sessionId, signingKey);
    return json({ status: "admitted", sessionId: result.sessionId, token });
  }

  if (result.status === "queued") {
    return json({
      status: "queued",
      position: result.position,
      retryAfterSec: result.retryAfterSec
    });
  }

  return json({ status: "expired" }, 404);
}

async function deleteSession(
  request: Request,
  env: Env,
  url: URL
): Promise<Response> {
  const sessionId = url.pathname.split("/").pop() ?? "";
  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/, "");
  const signingKey = env.SESSION_SIGNING_KEY ?? "dev-key-change-me";

  const verified = await verifyToken(token, signingKey);
  if (!verified.ok || verified.sessionId !== sessionId) {
    return json({ error: "unauthorized" }, 401);
  }

  if (isRevoked(sessionId)) {
    return json({ status: "pending" }, 202);
  }

  const coordinator = await getCoordinator(env);
  try {
    await coordinator.release(sessionId);
  } catch {
    // coordinator down — return pending tombstone
    revokeToken(sessionId, Date.now() + 24 * 60 * 60 * 1000);
    return json({ status: "pending" }, 202);
  }

  const doId = env.SupportSession.idFromName(sessionId);
  const stub = env.SupportSession.get(doId);

  let purged = false;
  try {
    const purgeResp = await stub.fetch(
      new Request(`https://internal/purge`, { method: "POST" })
    );
    purged = purgeResp.ok;
  } catch {
    // DO down — tombstone until expiry
  }

  revokeToken(sessionId, Date.now() + 24 * 60 * 60 * 1000);

  if (!purged) {
    return json({ status: "pending" }, 202);
  }

  return json({ status: "deleted" });
}
