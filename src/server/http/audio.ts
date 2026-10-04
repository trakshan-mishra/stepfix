import { verifyToken } from "./token";

const MAX_CLIP_DURATION_SEC = 15;
const MAX_CLIP_BYTES = 10 * 1024 * 1024;

interface AsrRequestBody {
  audio: string;
  mimeType?: string;
  durationSec?: number;
}

interface AsrResponse {
  transcript: string;
  confidence?: number;
}

export async function handleAudioRequest(
  request: Request,
  env: Env
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/audio/asr") return null;
  if (request.method !== "POST") return null;

  const auth = request.headers.get("Authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/, "");
  const signingKey = env.SESSION_SIGNING_KEY ?? "dev-key-change-me";
  const verified = await verifyToken(token, signingKey);
  if (!verified.ok) {
    return json({ error: "unauthorized" }, 401);
  }

  let body: AsrRequestBody;
  try {
    body = (await request.json()) as AsrRequestBody;
  } catch {
    return json({ error: "invalid body" }, 400);
  }

  if (!body.audio) {
    return json({ error: "audio required" }, 400);
  }

  const durationSec = body.durationSec ?? 0;
  if (durationSec > MAX_CLIP_DURATION_SEC) {
    return json({ error: "clip too long (max 15s)" }, 400);
  }

  const audioBytes = Math.ceil(body.audio.length * 0.75);
  if (audioBytes > MAX_CLIP_BYTES) {
    return json({ error: "clip too large" }, 413);
  }

  if ((env.LLM_MODE as string) === "mock" || !env.GROQ_API_KEY) {
    return json({
      transcript: "[mock ASR transcript]",
      confidence: 0.95
    } satisfies AsrResponse);
  }

  try {
    const audioBlob = base64ToBlob(body.audio, body.mimeType ?? "audio/wav");
    const formData = new FormData();
    formData.append("file", audioBlob, "clip.wav");
    formData.append("model", "whisper-large-v3-turbo");
    formData.append("response_format", "json");

    const resp = await fetch(
      "https://api.groq.com/openai/v1/audio/transcriptions",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
        body: formData,
        signal: AbortSignal.timeout(30_000)
      }
    );

    if (!resp.ok) {
      const text = await resp.text();
      return json(
        { error: `ASR failed: ${resp.status}`, detail: text },
        resp.status
      );
    }

    const result = (await resp.json()) as { text?: string };
    return json({
      transcript: result.text ?? "",
      confidence: 0.9
    } satisfies AsrResponse);
  } catch (e) {
    return json({ error: "ASR request failed", detail: String(e) }, 502);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) {
    byteNumbers[i] = byteChars.charCodeAt(i);
  }
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}
