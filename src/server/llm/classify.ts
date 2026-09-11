export type ErrorClass =
  | { kind: "rate_limit"; cooldownMs: number; retryAfterSec?: number }
  | { kind: "auth_error" }
  | { kind: "not_found" }
  | { kind: "server_error"; cooldownMs: number }
  | { kind: "timeout"; cooldownMs: number }
  | { kind: "network_error"; cooldownMs: number }
  | { kind: "unknown"; cooldownMs: number };

function isGeminiDailyQuota(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("quota") &&
    (lower.includes("daily") ||
      lower.includes("per day") ||
      lower.includes("resource"))
  );
}

export function classify(error: unknown): ErrorClass {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();

    if (
      msg.includes("429") ||
      msg.includes("rate limit") ||
      msg.includes("rate_limit")
    ) {
      if (isGeminiDailyQuota(msg)) {
        const cooldownMs = msUntilMidnightPacific();
        return { kind: "rate_limit", cooldownMs };
      }
      const retryAfter = extractRetryAfter(error);
      const cooldownMs = retryAfter ? retryAfter * 1000 : 60 * 1000;
      return { kind: "rate_limit", cooldownMs, retryAfterSec: retryAfter };
    }

    if (
      msg.includes("401") ||
      msg.includes("403") ||
      msg.includes("unauthorized") ||
      msg.includes("forbidden")
    ) {
      return { kind: "auth_error" };
    }

    if (
      msg.includes("404") ||
      msg.includes("not found") ||
      msg.includes("model not found")
    ) {
      return { kind: "not_found" };
    }

    if (
      msg.includes("timeout") ||
      msg.includes("timed out") ||
      msg.includes("abort") ||
      msg.includes("ttft")
    ) {
      return { kind: "timeout", cooldownMs: 20 * 1000 };
    }

    if (
      msg.includes("5xx") ||
      msg.includes("500") ||
      msg.includes("502") ||
      msg.includes("503") ||
      msg.includes("504") ||
      msg.includes("internal server")
    ) {
      return { kind: "server_error", cooldownMs: 30 * 1000 };
    }

    if (
      msg.includes("network") ||
      msg.includes("econnreset") ||
      msg.includes("socket") ||
      msg.includes("fetch failed")
    ) {
      return { kind: "network_error", cooldownMs: 30 * 1000 };
    }
  }

  return { kind: "unknown", cooldownMs: 30 * 1000 };
}

function extractRetryAfter(error: Error): number | undefined {
  const msg = error.message;
  const match = msg.match(/retry-after[:\s]+(\d+)/i);
  if (match) return parseInt(match[1], 10);
  return undefined;
}

function msUntilMidnightPacific(): number {
  const now = new Date();
  const pacific = new Date(
    now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" })
  );
  pacific.setHours(24, 0, 0, 0);
  return pacific.getTime() - now.getTime();
}

export const CIRCUIT_OPEN_MS = 2 * 60 * 1000;
export const CIRCUIT_THRESHOLD = 3;
