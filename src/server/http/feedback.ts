import { verifyToken } from "./token";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

export async function handleFeedbackRequest(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/api/feedback" && request.method === "POST") {
    const body = (await request.json()) as {
      sessionId?: string;
      token?: string;
      resolved?: boolean;
      thumbs?: number;
    };

    if (!body.sessionId || !body.token) {
      return json({ error: "sessionId and token required" }, 400);
    }

    const signingKey = env.SESSION_SIGNING_KEY ?? "dev-key-change-me";
    const verified = await verifyToken(body.token, signingKey);
    if (!verified.ok || verified.sessionId !== body.sessionId) {
      return json({ error: "unauthorized" }, 401);
    }

    try {
      await env.DB.prepare(
        "UPDATE sessions_index SET thumbs = ?, user_confirmed_fixed = ? WHERE session_id = ?"
      )
        .bind(body.thumbs ?? null, body.resolved ? 1 : 0, body.sessionId)
        .run();
    } catch {
      // best effort — D1 might not have the row yet
    }

    return json({ ok: true });
  }

  if (path === "/api/demand" && request.method === "POST") {
    const body = (await request.json()) as {
      sessionId?: string;
      token?: string;
      feature?: string;
    };

    if (!body.sessionId || !body.token || !body.feature) {
      return json({ error: "sessionId, token, and feature required" }, 400);
    }

    const signingKey = env.SESSION_SIGNING_KEY ?? "dev-key-change-me";
    const verified = await verifyToken(body.token, signingKey);
    if (!verified.ok || verified.sessionId !== body.sessionId) {
      return json({ error: "unauthorized" }, 401);
    }

    try {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO demand (session_id, feature, ts) VALUES (?, ?, ?)"
      )
        .bind(body.sessionId, body.feature, Date.now())
        .run();
    } catch {
      // best effort
    }

    return json({ ok: true });
  }

  return null;
}
