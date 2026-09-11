const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TEST_SECRET = "1x0000000000000000000000000000000AA";
const TIMEOUT_MS = 3000;

export async function verifyTurnstile(
  token: string,
  secretKey: string | undefined,
  remoteip?: string
): Promise<{ ok: boolean; error?: string }> {
  const secret = !secretKey || secretKey === "" ? TEST_SECRET : secretKey;

  const body = new URLSearchParams({ secret, response: token });
  if (remoteip) body.set("remoteip", remoteip);

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      body,
      signal: ctrl.signal
    });
    clearTimeout(timer);

    if (!res.ok) return { ok: false, error: "verify_failed" };

    const data = (await res.json()) as {
      success: boolean;
      "error-codes"?: string[];
    };
    if (!data.success)
      return { ok: false, error: data["error-codes"]?.[0] ?? "failed" };
    return { ok: true };
  } catch {
    return { ok: false, error: "timeout" };
  }
}

export const TURNSTILE_TEST_SITE_KEY = "1x00000000000000000000AA";
