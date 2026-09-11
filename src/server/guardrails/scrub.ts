export interface ScrubResult {
  text: string;
  counts: Record<string, number>;
  totalRemoved: number;
  usernameHidden: boolean;
}

const PATTERNS: Array<{ kind: string; pattern: RegExp; replace: string }> = [
  {
    kind: "anthropic",
    pattern: /sk-ant-[A-Za-z0-9_-]{20,}/g,
    replace: "[REDACTED:anthropic]"
  },
  {
    kind: "openai",
    pattern: /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g,
    replace: "[REDACTED:openai]"
  },
  {
    kind: "groq",
    pattern: /gsk_[A-Za-z0-9]{20,}/g,
    replace: "[REDACTED:groq]"
  },
  {
    kind: "github",
    pattern: /gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,}/g,
    replace: "[REDACTED:github]"
  },
  {
    kind: "aws_key_id",
    pattern: /AKIA[0-9A-Z]{16}/g,
    replace: "[REDACTED:aws_key_id]"
  },
  {
    kind: "google",
    pattern: /AIza[0-9A-Za-z_-]{35}/g,
    replace: "[REDACTED:google]"
  },
  {
    kind: "slack",
    pattern: /xox[abprs]-[A-Za-z0-9-]{10,}/g,
    replace: "[REDACTED:slack]"
  },
  {
    kind: "jwt",
    pattern: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
    replace: "[REDACTED:jwt]"
  },
  {
    kind: "private_key",
    pattern:
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replace: "[REDACTED:private_key]"
  },
  {
    kind: "url_credentials",
    pattern: /([a-z][a-z0-9+.-]*:\/\/)[^\s:/@]+:[^\s@/]+@/g,
    replace: "$1[REDACTED:url_credentials]@"
  },
  {
    kind: "assignment",
    pattern:
      /\b(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key)\b\s*[:=]\s*\S+/gi,
    replace: "[REDACTED:assignment]"
  }
];

const PATH_PATTERNS: Array<{ pattern: RegExp; replace: string }> = [
  { pattern: /\/home\/[^/\s]+/g, replace: "$HOME" },
  { pattern: /\/Users\/[^/\s]+/g, replace: "$HOME" },
  { pattern: /C:\\Users\\[^\\s]+\\/g, replace: "%USERPROFILE%\\" }
];

const SENSITIVE_PATTERNS: Array<{
  kind: string;
  pattern: RegExp;
  replace: string;
}> = [
  { kind: "otp", pattern: /\b\d{4}-\d{4}-\d{4}\b/g, replace: "[REDACTED:otp]" },
  { kind: "aadhaar", pattern: /\b\d{12}\b/g, replace: "[REDACTED:aadhaar]" },
  {
    kind: "pan",
    pattern: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g,
    replace: "[REDACTED:pan]"
  }
];

export function scrub(text: string): ScrubResult {
  let result = text;
  const counts: Record<string, number> = {};
  let totalRemoved = 0;
  let usernameHidden = false;

  for (const { kind, pattern, replace } of PATTERNS) {
    const matches = result.match(pattern);
    if (matches) {
      counts[kind] = matches.length;
      totalRemoved += matches.length;
      result = result.replace(pattern, replace);
    }
  }

  for (const { pattern, replace } of PATH_PATTERNS) {
    const matches = result.match(pattern);
    if (matches) {
      usernameHidden = true;
      result = result.replace(pattern, replace);
    }
  }

  for (const { kind, pattern, replace } of SENSITIVE_PATTERNS) {
    const matches = result.match(pattern);
    if (matches) {
      counts[kind] = matches.length;
      totalRemoved += matches.length;
      result = result.replace(pattern, replace);
    }
  }

  return { text: result, counts, totalRemoved, usernameHidden };
}
