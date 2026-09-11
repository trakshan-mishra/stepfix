export interface ChaosFlags {
  "429": number;
  timeout: number;
  cut: number;
  all_down: number;
  vectorize_down: number;
  d1_down: number;
}

export function parseChaos(raw: string | undefined): ChaosFlags {
  const defaults: ChaosFlags = {
    "429": 0,
    timeout: 0,
    cut: 0,
    all_down: 0,
    vectorize_down: 0,
    d1_down: 0
  };

  if (!raw || raw.trim() === "") return defaults;

  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const colonIdx = trimmed.lastIndexOf(":");
    if (colonIdx < 0) continue;
    const name = trimmed.slice(0, colonIdx).trim();
    const prob = parseFloat(trimmed.slice(colonIdx + 1));
    if (Number.isNaN(prob)) continue;
    if (name in defaults) {
      (defaults as unknown as Record<string, number>)[name] = prob;
    }
  }

  return defaults;
}

export function shouldChaos(
  flags: ChaosFlags,
  type: keyof ChaosFlags
): boolean {
  const prob = flags[type];
  if (prob <= 0) return false;
  return Math.random() < prob;
}

export function effectiveChaos(
  raw: string | undefined,
  appEnv: string | undefined
): ChaosFlags {
  if (appEnv === "production") return parseChaos("");
  return parseChaos(raw);
}
