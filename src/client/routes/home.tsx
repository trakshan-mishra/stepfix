import { useState, useEffect, useCallback } from "react";
import { TURNSTILE_TEST_SITE_KEY } from "../../server/http/turnstile";

interface StartResponse {
  status: "admitted" | "queued" | "rejected";
  sessionId?: string;
  token?: string;
  ticket?: string;
  position?: number;
  retryAfterSec?: number;
  reason?: string;
}

interface QueueResponse {
  status: "admitted" | "queued" | "expired";
  sessionId?: string;
  token?: string;
  position?: number;
  retryAfterSec?: number;
}

export default function Home({
  onStart
}: {
  onStart: (sessionId: string, token: string) => void;
}) {
  const [turnstileReady, setTurnstileReady] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [queued, setQueued] = useState<{
    ticket: string;
    position: number;
    retryAfterSec: number;
  } | null>(null);
  const [siteKey] = useState(() => {
    const env = import.meta.env as Record<string, string | undefined>;
    return env.VITE_TURNSTILE_SITE_KEY ?? TURNSTILE_TEST_SITE_KEY;
  });

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    script.onload = () => setTurnstileReady(true);
    document.head.appendChild(script);
    return () => {
      script.remove();
    };
  }, []);

  useEffect(() => {
    if (!turnstileReady || !siteKey) return;
    const w = window as unknown as {
      turnstile?: {
        render: (
          el: string | HTMLElement,
          opts: Record<string, unknown>
        ) => string;
        remove: (id: string) => void;
      };
    };
    const ts = w.turnstile;
    if (!ts) return;
    const id = ts.render("#turnstile-container", {
      sitekey: siteKey,
      callback: (token: string) => setTurnstileToken(token),
      "error-callback": () => setError("Turnstile failed. Please try again.")
    });
    return () => {
      ts.remove(id);
    };
  }, [turnstileReady, siteKey]);

  const start = useCallback(async () => {
    if (!turnstileToken) {
      setError("Please complete the verification first.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ turnstileToken })
      });
      const data: StartResponse = await res.json();
      if (data.status === "admitted" && data.token) {
        onStart(data.sessionId!, data.token);
      } else if (data.status === "queued" && data.ticket) {
        setQueued({
          ticket: data.ticket,
          position: data.position!,
          retryAfterSec: data.retryAfterSec ?? 20
        });
      } else {
        setError(data.reason ?? "Something went wrong. Please try again.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [turnstileToken, onStart]);

  if (queued) {
    return (
      <WaitingRoom
        ticket={queued.ticket}
        position={queued.position}
        retryAfterSec={queued.retryAfterSec}
        onAdmitted={onStart}
      />
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-6">
          <span className="text-4xl">🔧</span>
          <h1 className="text-2xl font-bold text-gray-900 mt-2">stepfix</h1>
          <p className="text-gray-500 mt-1">
            AI support that shows its work. You run every command yourself.
          </p>
        </div>
        <div id="turnstile-container" className="mb-4 min-h-[65px]" />
        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
        <button
          onClick={start}
          disabled={!turnstileToken || loading}
          className="w-full py-3 px-4 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? "Starting..." : "Start a support session"}
        </button>
        <div className="mt-4 text-center">
          <a href="/library" className="text-sm text-blue-600 hover:underline">
            Browse the script library
          </a>
          <span className="mx-2 text-gray-300">·</span>
          <a href="/privacy" className="text-sm text-blue-600 hover:underline">
            Privacy
          </a>
        </div>
      </div>
    </div>
  );
}

function WaitingRoom({
  ticket,
  position,
  retryAfterSec,
  onAdmitted
}: {
  ticket: string;
  position: number;
  retryAfterSec: number;
  onAdmitted: (sessionId: string, token: string) => void;
}) {
  const [pos, setPos] = useState(position);
  const [pollError, setPollError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      const jitter = 15000 + Math.random() * 10000;
      await new Promise((r) => setTimeout(r, jitter));
      if (cancelled) return;
      try {
        const res = await fetch(`/api/session/queue/${ticket}`);
        const data: QueueResponse = await res.json();
        if (cancelled) return;
        if (data.status === "admitted" && data.token) {
          onAdmitted(data.sessionId!, data.token);
        } else if (data.status === "queued") {
          setPos(data.position ?? pos);
          poll();
        } else {
          setPollError("Your session expired. Please start again.");
        }
      } catch {
        setPollError("Connection error. Retrying...");
        poll();
      }
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, [ticket, onAdmitted, pos]);

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="text-4xl mb-3">⏳</div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">You're in line</h1>
        <p className="text-gray-600 mb-4">
          Position #{pos}. We'll start your session as soon as a slot opens.
        </p>
        {pollError && <p className="text-red-600 text-sm mb-3">{pollError}</p>}
        <p className="text-gray-400 text-sm">
          Estimated wait: ~{Math.ceil((pos * retryAfterSec) / 60)} min
        </p>
        <div className="mt-4">
          <a href="/library" className="text-sm text-blue-600 hover:underline">
            Browse the library while you wait
          </a>
        </div>
      </div>
    </div>
  );
}
