import type { Card } from "../../server/agent/case-file";

const CACHE_KEY = "stepfix:cached-card";

export function cacheCard(card: Card): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(card));
  } catch {
    // localStorage may be unavailable
  }
}

export function getCachedCard(): Card | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as Card;
  } catch {
    return null;
  }
}

export function clearCachedCard(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // ignore
  }
}
