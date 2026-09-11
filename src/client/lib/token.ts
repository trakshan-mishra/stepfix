const TOKEN_KEY = "stepfix:token";
const SESSION_KEY = "stepfix:session";

export function saveSession(sessionId: string, token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(SESSION_KEY, sessionId);
  } catch {
    // localStorage may be unavailable (private mode)
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getSessionId(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}
