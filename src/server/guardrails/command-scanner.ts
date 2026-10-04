import { getAllScripts } from "../library/index";

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

// Phrases that look like commands but are plain English. Checked against the
// matched text only, never the surrounding sentence: a nearby "Wi-Fi" must not
// hide a real command.
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

// Binaries outside the library that are dangerous enough to catch on their own.
const DANGEROUS_BINARIES = [
  "rm",
  "curl",
  "wget",
  "iwr",
  "iex",
  "powershell",
  "pwsh",
  "bash",
  "chmod",
  "chown",
  "dd",
  "mkfs",
  "diskpart",
  "bcdedit",
  "apt",
  "dnf",
  "pacman",
  "brew",
  "npx",
  "pip",
  "rundll32",
  "mshta",
  "certutil",
  "regsvr32"
];

// Words that end a command when it is written inline in a sentence.
const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "but",
  "for",
  "if",
  "in",
  "it",
  "look",
  "me",
  "on",
  "or",
  "see",
  "should",
  "so",
  "tell",
  "that",
  "the",
  "then",
  "this",
  "to",
  "what",
  "when",
  "which",
  "will",
  "with",
  "you",
  "your"
]);

const CARD_POINTER = "[the command on the step card]";
const REMOVED = "[command removed]";

interface Span {
  start: number;
  end: number;
  fromLibrary: boolean;
}

interface LibraryIndex {
  // binary -> second tokens it is used with in the library ("ip" -> "-brief", "route")
  subcommands: Map<string, Set<string>>;
  // PowerShell cmdlets used by the library (Verb-Noun), matched on their own
  cmdlets: Set<string>;
  // one pattern per library command, with {{params}} as wildcards
  commandPatterns: RegExp[];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

let libraryIndex: LibraryIndex | null = null;

function getLibraryIndex(): LibraryIndex {
  if (libraryIndex) return libraryIndex;
  const subcommands = new Map<string, Set<string>>();
  const cmdlets = new Set<string>();
  const commandPatterns: RegExp[] = [];

  for (const entry of getAllScripts()) {
    const command = (entry as { command?: string }).command;
    if (!command) continue;

    const tokens = command.trim().split(/\s+/);
    const [binary, second] = tokens[0] === "sudo" ? tokens.slice(1) : tokens;
    if (binary && !binary.startsWith("$")) {
      if (/^[A-Z][a-z]+-[A-Za-z]+$/.test(binary)) {
        cmdlets.add(binary.toLowerCase());
      } else {
        const set = subcommands.get(binary) ?? new Set<string>();
        if (second && !second.includes("{{")) set.add(second);
        subcommands.set(binary, set);
      }
    }

    const pattern = command
      .trim()
      .split(/(\{\{\w+\}\})/)
      .map((part) =>
        /^\{\{\w+\}\}$/.test(part)
          ? "\\S+"
          : escapeRegExp(part).replace(/\s+/g, "\\s+")
      )
      .join("");
    commandPatterns.push(new RegExp(pattern, "g"));
  }

  libraryIndex = { subcommands, cmdlets, commandPatterns };
  return libraryIndex;
}

function isArgToken(token: string): boolean {
  const bare = token.replace(/[.,;:!?)]+$/, "");
  if (!bare) return false;
  if (STOP_WORDS.has(bare.toLowerCase())) return false;
  if (/^[A-Z][a-z]/.test(bare) && !/^[A-Z][a-z]+-[A-Za-z]+$/.test(bare)) {
    // A capitalised word starts a new sentence, unless it is a cmdlet.
    return false;
  }
  return /^[\w./:=|@$*{}"'\\-]+$/.test(bare);
}

// From a command start, take argument-like tokens up to the end of the line,
// a stop word, or the end of the sentence.
function extendCommand(
  text: string,
  start: number,
  firstTokenEnd: number
): number {
  let end = firstTokenEnd;
  const re = /[ \t]+(\S+)/y;
  re.lastIndex = end;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const token = m[1];
    if (!isArgToken(token)) break;
    const trailing = token.match(/[.,;:!?)]+$/)?.[0] ?? "";
    end = m.index + m[0].length - trailing.length;
    if (trailing && /[.;!?]/.test(trailing)) break;
    re.lastIndex = m.index + m[0].length;
  }
  return Math.max(end, start);
}

function findSpans(text: string): Span[] {
  const spans: Span[] = [];
  const add = (start: number, end: number, fromLibrary: boolean) => {
    if (end > start) spans.push({ start, end, fromLibrary });
  };

  // Code fences and inline code.
  for (const m of text.matchAll(/```[\s\S]*?```/g)) {
    add(m.index!, m.index! + m[0].length, false);
  }
  for (const m of text.matchAll(/`[^`\n]+`/g)) {
    add(m.index!, m.index! + m[0].length, false);
  }
  // Lines written as a shell prompt.
  for (const m of text.matchAll(
    /^(?:```.*|\$\s.*|#\s.*|PS>.*|[A-Z]:\\>.*|sudo\s.*)$/gm
  )) {
    add(m.index!, m.index! + m[0].length, false);
  }

  const index = getLibraryIndex();

  // Exact library commands, with any parameter values.
  for (const pattern of index.commandPatterns) {
    pattern.lastIndex = 0;
    for (const m of text.matchAll(pattern)) {
      add(m.index!, m.index! + m[0].length, true);
    }
  }

  // A library binary followed by a flag or by a subcommand the library uses it with.
  for (const m of text.matchAll(
    /(?:^|(?<=[\s(:"'“]))(sudo\s+)?([\w.$:-]+)(?=\s+(\S+))/g
  )) {
    const binary = m[2];
    const next = m[3].replace(/[.,;:!?)]+$/, "");
    const lower = binary.toLowerCase();
    const start = m.index!;
    const tokenEnd = start + m[0].length;
    if (index.cmdlets.has(lower)) {
      add(start, extendCommand(text, start, tokenEnd), true);
      continue;
    }
    const subs = index.subcommands.get(binary);
    if (subs && (next.startsWith("-") || subs.has(next))) {
      add(start, extendCommand(text, start, tokenEnd), true);
      continue;
    }
    if (DANGEROUS_BINARIES.includes(lower) && isArgToken(next)) {
      add(start, extendCommand(text, start, tokenEnd), false);
    }
  }

  // A library cmdlet on its own ("type Get-NetAdapter").
  for (const m of text.matchAll(/\b[A-Z][a-z]+-[A-Za-z]+\b/g)) {
    if (index.cmdlets.has(m[0].toLowerCase())) {
      const start = m.index!;
      add(start, extendCommand(text, start, start + m[0].length), true);
    }
  }

  // Merge overlapping spans; a merged span counts as library if any part was.
  spans.sort((a, b) => a.start - b.start);
  const merged: Span[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
      last.fromLibrary = last.fromLibrary || span.fromLibrary;
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

export interface ScanResult {
  hit: boolean;
  matches: Array<{ name: string; excerpt: string }>;
}

export function scanForCommands(text: string): ScanResult {
  const matches: Array<{ name: string; excerpt: string }> = [];

  for (const { name, pattern } of SCAN_PATTERNS) {
    const m = pattern.exec(text);
    if (m && (name === "known_binary" || !isPlainMention(m[0]))) {
      const start = Math.max(0, m.index - 20);
      const end = Math.min(text.length, m.index + 60);
      matches.push({ name, excerpt: text.slice(start, end).trim() });
    }
  }

  for (const span of findSpans(text)) {
    matches.push({
      name: span.fromLibrary ? "library_command" : "command_text",
      excerpt: text.slice(span.start, span.end)
    });
  }

  return { hit: matches.length > 0, matches };
}

function isPlainMention(matched: string): boolean {
  return PLAIN_MENTIONS.some((p) => p.test(matched));
}

export function redactCommands(text: string): string {
  const spans = findSpans(text);
  if (spans.length === 0) return text;
  let out = "";
  let cursor = 0;
  for (const span of spans) {
    out += text.slice(cursor, span.start);
    out += span.fromLibrary ? CARD_POINTER : REMOVED;
    cursor = span.end;
  }
  return out + text.slice(cursor);
}
