const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64urlEncode(data: Uint8Array): string {
  let str = "";
  for (const b of data) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(str: string): Uint8Array {
  const padded = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4;
  const b64 = pad ? padded + "=".repeat(4 - pad) : padded;
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return new Uint8Array(sig);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export async function signToken(
  sessionId: string,
  secret: string,
  now: number = Date.now()
): Promise<string> {
  const expiry = now + TOKEN_TTL_MS;
  const payload = `${sessionId}.${expiry}`;
  const sig = await hmac(secret, payload);
  const sigB64 = base64urlEncode(sig);
  return `${base64urlEncode(encoder.encode(payload))}.${sigB64}`;
}

export async function verifyToken(
  token: string,
  secret: string,
  now: number = Date.now()
): Promise<{ ok: true; sessionId: string } | { ok: false; reason: string }> {
  const dotIdx = token.lastIndexOf(".");
  if (dotIdx < 0) return { ok: false, reason: "malformed" };

  const payloadB64 = token.slice(0, dotIdx);
  const sigB64 = token.slice(dotIdx + 1);

  let payloadStr: string;
  try {
    payloadStr = decoder.decode(base64urlDecode(payloadB64));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const lastDot = payloadStr.lastIndexOf(".");
  if (lastDot < 0) return { ok: false, reason: "malformed" };

  const sessionId = payloadStr.slice(0, lastDot);
  const expiryStr = payloadStr.slice(lastDot + 1);
  const expiry = parseInt(expiryStr, 10);
  if (!Number.isFinite(expiry)) return { ok: false, reason: "malformed" };

  if (now > expiry) return { ok: false, reason: "expired" };

  let providedSig: Uint8Array;
  try {
    providedSig = base64urlDecode(sigB64);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const expectedSig = await hmac(secret, payloadStr);
  if (!timingSafeEqual(providedSig, expectedSig)) {
    return { ok: false, reason: "tampered" };
  }

  return { ok: true, sessionId };
}
