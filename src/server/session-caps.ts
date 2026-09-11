const MAX_USER_MESSAGES = 40;
const MAX_SCREENSHOTS = 6;
const MAX_MESSAGE_CHARS = 4000;
const MAX_PASTE_CHARS = 8000;
const MAX_TECHNICIAN_STEPS = 12;

export interface SessionState {
  counters: { userMessages: number; screenshots: number; violations: number };
  steps: Array<{ status: string }>;
  phase: string;
}

export function checkCaps(state: SessionState): {
  ok: boolean;
  message?: string;
} {
  if (state.counters.userMessages >= MAX_USER_MESSAGES) {
    return {
      ok: false,
      message:
        "You've reached the message limit for this session. Please start a new session."
    };
  }
  if (state.counters.screenshots >= MAX_SCREENSHOTS) {
    return {
      ok: false,
      message:
        "You've shared enough screenshots for this session. Please describe what you see instead."
    };
  }
  if (
    state.steps.length >= MAX_TECHNICIAN_STEPS &&
    state.phase === "technician"
  ) {
    return {
      ok: false,
      message:
        "We've tried many steps. Would you like me to escalate this to a human with a full report?"
    };
  }
  return { ok: true };
}

export function checkMessageLength(text: string): {
  ok: boolean;
  message?: string;
} {
  if (text.length > MAX_MESSAGE_CHARS) {
    return {
      ok: false,
      message: `That message is too long (${text.length} chars). Please keep it under ${MAX_MESSAGE_CHARS} characters.`
    };
  }
  return { ok: true };
}

export function truncatePaste(text: string): string {
  if (text.length <= MAX_PASTE_CHARS) return text;
  const head = text.slice(0, 3000);
  const tail = text.slice(-3000);
  return `${head}\n[...truncated ${text.length - 6000} chars...]\n${tail}`;
}

export {
  MAX_USER_MESSAGES,
  MAX_SCREENSHOTS,
  MAX_MESSAGE_CHARS,
  MAX_PASTE_CHARS,
  MAX_TECHNICIAN_STEPS
};
