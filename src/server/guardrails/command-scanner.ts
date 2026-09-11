const SCAN_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  { name: "fenced_code_block", pattern: /^```/m },
  { name: "inline_code_with_space", pattern: /`[^`]+ [^`]+`/ },
  { name: "dollar_prompt", pattern: /^\$\s/m },
  { name: "hash_prompt", pattern: /^#\s/m },
  { name: "ps_prompt", pattern: /^PS>/m },
  { name: "cmd_prompt", pattern: /^[A-Z]:\\>/m },
  { name: "sudo_prefix", pattern: /^sudo\s/m },
  {
    name: "known_binary",
    pattern:
      /\b(rm|del|format|reg|curl|wget|iwr|iex|powershell|pwsh|bash|sh|chmod|chown|dd|mkfs|diskpart|bcdedit|netsh|systemctl|apt|dnf|pacman|brew|npm|npx|pip|sc|rundll32|mshta|certutil|regsvr32)\b\s/i
  },
  { name: "invoke_cmdlet", pattern: /\bInvoke-\w+\s/i },
  { name: "set_cmdlet", pattern: /\bSet-\w+\s/i },
  { name: "remove_cmdlet", pattern: /\bRemove-\w+\s/i },
  { name: "start_process", pattern: /\bStart-Process\s/i }
];

const PLAIN_MENTIONS = [
  /\bthe bluetooth service\b/i,
  /\byour terminal\b/i,
  /\byour computer\b/i,
  /\bthe adapter\b/i,
  /\bthe driver\b/i,
  /\bthe service\b/i,
  /\bthe network\b/i,
  /\bwi-?fi\b/i
];

export interface ScanResult {
  hit: boolean;
  matches: Array<{ name: string; excerpt: string }>;
}

export function scanForCommands(text: string): ScanResult {
  const matches: Array<{ name: string; excerpt: string }> = [];

  for (const { name, pattern } of SCAN_PATTERNS) {
    const m = pattern.exec(text);
    if (m) {
      const start = Math.max(0, m.index - 20);
      const end = Math.min(text.length, m.index + 60);
      const excerpt = text.slice(start, end).trim();
      if (!isPlainMention(excerpt)) {
        matches.push({ name, excerpt });
      }
    }
  }

  return { hit: matches.length > 0, matches };
}

function isPlainMention(excerpt: string): boolean {
  return PLAIN_MENTIONS.some((p) => p.test(excerpt));
}

export function redactCommands(text: string): string {
  let redacted = text;

  redacted = redacted.replace(/```[\s\S]*?```/g, "[command removed]");
  redacted = redacted.replace(/`[^`]+`/g, "[command removed]");

  redacted = redacted.replace(/^```.*$/gm, "[command removed]");
  redacted = redacted.replace(/^\$\s.*$/gm, "[command removed]");
  redacted = redacted.replace(/^#\s.*$/gm, "[command removed]");
  redacted = redacted.replace(/^PS>.*$/gm, "[command removed]");
  redacted = redacted.replace(/^[A-Z]:\\>.*$/gm, "[command removed]");
  redacted = redacted.replace(/^sudo\s.*$/gm, "[command removed]");

  return redacted;
}
