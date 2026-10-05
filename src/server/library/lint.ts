import {
  type Entry,
  type Flow,
  type NextRule,
  ID_PATTERN,
  SPECIAL_TARGETS,
  PIPE_ALLOWLIST,
  FORBIDDEN_PATTERNS
} from "./schema";

export type LintIssue = {
  level: "error" | "info";
  rule: string;
  id: string;
  message: string;
};

export function checkIdUniqueness(entries: Entry[]): LintIssue[] {
  const issues: LintIssue[] = [];
  const seen = new Map<string, number>();
  for (const e of entries) {
    if (seen.has(e.id)) {
      issues.push({
        level: "error",
        rule: "id_unique",
        id: e.id,
        message: `Duplicate id "${e.id}" (also at index ${seen.get(e.id)})`
      });
    } else {
      seen.set(e.id, entries.indexOf(e));
    }
  }
  return issues;
}

export function checkIdPattern(entries: Entry[]): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const e of entries) {
    if (!ID_PATTERN.test(e.id)) {
      issues.push({
        level: "error",
        rule: "id_pattern",
        id: e.id,
        message: `Id "${e.id}" does not match the required pattern`
      });
    }
  }
  return issues;
}

function getGotoTargets(next: NextRule[]): string[] {
  return next.map((rule) => ("goto" in rule ? rule.goto : rule.default));
}

export function checkGotoTargets(
  entries: Entry[],
  allIds: Set<string>
): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const e of entries) {
    for (const target of getGotoTargets(e.next)) {
      if (!SPECIAL_TARGETS.has(target) && !allIds.has(target)) {
        issues.push({
          level: "error",
          rule: "goto_exists",
          id: e.id,
          message: `goto target "${target}" does not exist`
        });
      }
    }
  }
  return issues;
}

export function checkNextCycles(entries: Entry[]): LintIssue[] {
  const issues: LintIssue[] = [];

  const allGotos = new Map<string, string[]>();
  for (const e of entries) {
    allGotos.set(
      e.id,
      getGotoTargets(e.next).filter((t) => !SPECIAL_TARGETS.has(t))
    );
  }

  const reverse = new Map<string, Set<string>>();
  for (const e of entries) reverse.set(e.id, new Set());
  for (const [from, targets] of allGotos) {
    for (const to of targets) {
      if (!reverse.has(to)) reverse.set(to, new Set());
      reverse.get(to)!.add(from);
    }
  }

  const canReachExit = new Set<string>();
  const queue: string[] = [];
  for (const e of entries) {
    for (const target of getGotoTargets(e.next)) {
      if (SPECIAL_TARGETS.has(target)) {
        queue.push(e.id);
        break;
      }
    }
  }

  while (queue.length > 0) {
    const node = queue.shift()!;
    if (canReachExit.has(node)) continue;
    canReachExit.add(node);
    const preds = reverse.get(node);
    if (preds) {
      for (const pred of preds) {
        if (!canReachExit.has(pred)) queue.push(pred);
      }
    }
  }

  for (const e of entries) {
    if (!canReachExit.has(e.id)) {
      issues.push({
        level: "error",
        rule: "next_cycle",
        id: e.id,
        message: `entry "${e.id}" cannot reach RESOLVED, ESCALATE, or FLOW_ENTRY through any next path`
      });
    }
  }
  return issues;
}

export function checkKindConsistency(entries: Entry[]): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const e of entries) {
    if (e.kind === "command") {
      if (!e.command) {
        issues.push({
          level: "error",
          rule: "kind_command",
          id: e.id,
          message: "kind: command requires a command field"
        });
      }
      if (e.manual_steps && e.manual_steps.length > 0) {
        issues.push({
          level: "error",
          rule: "kind_command",
          id: e.id,
          message: "kind: command must not have manual_steps"
        });
      }
    }
    if (e.kind === "manual") {
      if (e.command) {
        issues.push({
          level: "error",
          rule: "kind_manual",
          id: e.id,
          message: "kind: manual must not have a command field"
        });
      }
      if (!e.manual_steps || e.manual_steps.length === 0) {
        issues.push({
          level: "error",
          rule: "kind_manual",
          id: e.id,
          message: "kind: manual requires manual_steps"
        });
      }
    }
  }
  return issues;
}

export function checkUndoRequirement(entries: Entry[]): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const e of entries) {
    if (e.risk !== "read_only" && (!e.undo || e.undo.trim() === "")) {
      issues.push({
        level: "error",
        rule: "undo_required",
        id: e.id,
        message: `risk "${e.risk}" requires a non-empty undo`
      });
    }
  }
  return issues;
}

export function checkExplanationLength(entries: Entry[]): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const e of entries) {
    const len = e.explanation.length;
    if (len < 80) {
      issues.push({
        level: "error",
        rule: "explanation_length",
        id: e.id,
        message: `explanation is ${len} chars, minimum is 80`
      });
    }
    if (len > 700) {
      issues.push({
        level: "error",
        rule: "explanation_length",
        id: e.id,
        message: `explanation is ${len} chars, maximum is 700`
      });
    }
  }
  return issues;
}

export function checkExpectRegex(entries: Entry[]): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const e of entries) {
    for (const expect of e.expect) {
      try {
        new RegExp(expect.pattern, "im");
      } catch (err) {
        issues.push({
          level: "error",
          rule: "expect_regex",
          id: e.id,
          message: `expect pattern "${expect.pattern}" does not compile: ${(err as Error).message}`
        });
      }
    }
  }
  return issues;
}

export function checkFlows(flows: Flow[], entries: Entry[]): LintIssue[] {
  const issues: LintIssue[] = [];
  const entryMap = new Map(entries.map((e) => [e.id, e]));

  for (const flow of flows) {
    const entry = entryMap.get(flow.entry);
    if (!entry) {
      issues.push({
        level: "error",
        rule: "flow_entry_exists",
        id: flow.entry,
        message: `flow entry "${flow.entry}" does not exist in the library`
      });
      continue;
    }

    const familyOsPrefix = flow.os_family === "linux" ? "linux" : "win";
    const coversFamily = entry.os.some(
      (os) => os === familyOsPrefix || os.startsWith(familyOsPrefix)
    );
    if (!coversFamily && flow.os_family === "linux") {
      const coversLinux =
        entry.os.includes("ubuntu") ||
        entry.os.includes("debian") ||
        entry.os.includes("linux_other");
      if (!coversLinux) {
        issues.push({
          level: "error",
          rule: "flow_os_coverage",
          id: flow.entry,
          message: `flow entry "${flow.entry}" os [${entry.os.join(", ")}] does not cover family "${flow.os_family}"`
        });
      }
    } else if (!coversFamily && flow.os_family === "windows") {
      const coversWindows =
        entry.os.includes("windows11") || entry.os.includes("windows10");
      if (!coversWindows) {
        issues.push({
          level: "error",
          rule: "flow_os_coverage",
          id: flow.entry,
          message: `flow entry "${flow.entry}" os [${entry.os.join(", ")}] does not cover family "${flow.os_family}"`
        });
      }
    }
  }
  return issues;
}

export function checkCommandHygiene(entries: Entry[]): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const e of entries) {
    if (e.kind !== "command" || !e.command) continue;
    const cmd = e.command;

    for (const { name, pattern } of FORBIDDEN_PATTERNS) {
      if (pattern.test(cmd)) {
        issues.push({
          level: "error",
          rule: "command_hygiene",
          id: e.id,
          message: `command matches forbidden pattern "${name}": ${cmd}`
        });
      }
    }

    // eslint-disable-next-line no-control-regex
    if (!/^[\u0000-\u007F]*$/.test(cmd)) {
      issues.push({
        level: "error",
        rule: "command_ascii",
        id: e.id,
        message: "command contains non-ASCII characters"
      });
    }

    if (cmd.includes("\n")) {
      issues.push({
        level: "error",
        rule: "command_newline",
        id: e.id,
        message: "command contains a newline"
      });
    }

    if (cmd.length > 200) {
      issues.push({
        level: "error",
        rule: "command_length",
        id: e.id,
        message: `command is ${cmd.length} chars, maximum is 200`
      });
    }
  }
  return issues;
}

export function checkChaining(entries: Entry[]): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const e of entries) {
    if (e.kind !== "command" || !e.command) continue;
    const cmd = e.command;

    if (hasUnquotedChar(cmd, ";")) {
      issues.push({
        level: "error",
        rule: "chaining_semicolon",
        id: e.id,
        message: "command contains a semicolon (;), which is banned"
      });
    }

    if (cmd.includes("&&")) {
      if (!e.compound) {
        issues.push({
          level: "error",
          rule: "chaining_compound",
          id: e.id,
          message: "command contains && but compound is not set to true"
        });
      } else {
        const parts = splitOnTopLevel(cmd, "&&");
        for (const part of parts) {
          const subIssues = checkCommandHygiene([
            { ...e, command: part.trim() }
          ]);
          for (const si of subIssues) {
            issues.push({
              ...si,
              message: `compound part "${part.trim()}": ${si.message}`
            });
          }
        }
      }
    }
  }
  return issues;
}

export function checkPipes(entries: Entry[]): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const e of entries) {
    if (e.kind !== "command" || !e.command) continue;
    const cmd = e.command;

    const segments = splitOnTopLevel(cmd, "|");
    if (segments.length <= 1) continue;

    for (let i = 1; i < segments.length; i++) {
      const rightSide = segments[i].trim();
      const cmdName = extractCommandName(rightSide);
      if (!PIPE_ALLOWLIST.has(cmdName)) {
        issues.push({
          level: "error",
          rule: "pipe_allowlist",
          id: e.id,
          message: `pipe target "${cmdName}" is not in the allowlist (allowed: ${[...PIPE_ALLOWLIST].join(", ")})`
        });
      }
    }
  }
  return issues;
}

export function checkPackageInstall(entries: Entry[]): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const e of entries) {
    if (e.kind !== "command" || !e.command) continue;
    const cmd = e.command;

    if (/\bapt\s+install\b/i.test(cmd) || /\bapt-get\s+install\b/i.test(cmd)) {
      if (!/\bsudo\s+apt/i.test(cmd)) {
        issues.push({
          level: "error",
          rule: "package_install_sudo",
          id: e.id,
          message: "apt install must use sudo"
        });
      }
      if (e.risk === "read_only") {
        issues.push({
          level: "error",
          rule: "package_install_risk",
          id: e.id,
          message: "package install must be safe_change or higher"
        });
      }
      if (!e.undo) {
        issues.push({
          level: "error",
          rule: "package_install_undo",
          id: e.id,
          message: "package install must have an undo"
        });
      }
    }
  }
  return issues;
}

export function checkParamSafety(entries: Entry[]): LintIssue[] {
  const issues: LintIssue[] = [];
  for (const e of entries) {
    if (!e.params) continue;
    for (const [name, param] of Object.entries(e.params)) {
      if (param.type === "regex") {
        if (!param.pattern) {
          issues.push({
            level: "error",
            rule: "param_regex_pattern",
            id: e.id,
            message: `param "${name}" is type regex but has no pattern`
          });
          continue;
        }
        if (!param.pattern.startsWith("^") || !param.pattern.endsWith("$")) {
          issues.push({
            level: "error",
            rule: "param_regex_anchored",
            id: e.id,
            message: `param "${name}" regex pattern must be anchored (^...$)`
          });
        }
        try {
          new RegExp(param.pattern);
        } catch (err) {
          issues.push({
            level: "error",
            rule: "param_regex_compiles",
            id: e.id,
            message: `param "${name}" regex does not compile: ${(err as Error).message}`
          });
        }
      }
      if (param.type === "enum") {
        if (!param.values || param.values.length === 0) {
          issues.push({
            level: "error",
            rule: "param_enum_values",
            id: e.id,
            message: `param "${name}" is type enum but has no values`
          });
        }
      }
    }
  }
  return issues;
}

export function checkUnreachable(entries: Entry[], flows: Flow[]): LintIssue[] {
  const issues: LintIssue[] = [];
  const referenced = new Set<string>();

  for (const flow of flows) {
    referenced.add(flow.entry);
  }

  for (const e of entries) {
    for (const target of getGotoTargets(e.next)) {
      if (!SPECIAL_TARGETS.has(target)) {
        referenced.add(target);
      }
    }
  }

  for (const e of entries) {
    if (!referenced.has(e.id)) {
      issues.push({
        level: "info",
        rule: "unreachable",
        id: e.id,
        message: `entry "${e.id}" is not reachable from any flow or goto`
      });
    }
  }

  return issues;
}

export function lintLibrary(entries: Entry[], flows: Flow[]): LintIssue[] {
  const allIds = new Set(entries.map((e) => e.id));
  return [
    ...checkIdUniqueness(entries),
    ...checkIdPattern(entries),
    ...checkGotoTargets(entries, allIds),
    ...checkNextCycles(entries),
    ...checkKindConsistency(entries),
    ...entries.flatMap((e): LintIssue[] => {
      if (
        !e.purpose ||
        (e.verifies_original_task &&
          (e.purpose !== "verification" ||
            e.kind !== "manual" ||
            e.risk !== "read_only"))
      ) {
        return [
          {
            level: "error",
            rule: "workflow_metadata",
            id: e.id,
            message:
              "Every entry needs a purpose; original-task verification must be a read-only manual check."
          }
        ];
      }
      return [];
    }),
    ...checkUndoRequirement(entries),
    ...checkExplanationLength(entries),
    ...checkExpectRegex(entries),
    ...checkFlows(flows, entries),
    ...checkCommandHygiene(entries),
    ...checkChaining(entries),
    ...checkPipes(entries),
    ...checkPackageInstall(entries),
    ...checkParamSafety(entries),
    ...checkUnreachable(entries, flows)
  ];
}

function splitOnTopLevel(str: string, delimiter: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let i = 0;

  while (i < str.length) {
    const ch = str[i];
    const rest = str.slice(i);

    if (inSingle) {
      current += ch;
      if (ch === "'") inSingle = false;
      i++;
      continue;
    }

    if (inDouble) {
      current += ch;
      if (ch === "\\") {
        current += str[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (ch === '"') inDouble = false;
      i++;
      continue;
    }

    if (rest.startsWith(delimiter)) {
      parts.push(current);
      current = "";
      i += delimiter.length;
      continue;
    }

    if (ch === "'") {
      inSingle = true;
      current += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      current += ch;
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  parts.push(current);
  return parts;
}

function hasUnquotedChar(str: string, char: string): boolean {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (inSingle) {
      if (ch === "'") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === "\\") {
        i++;
        continue;
      }
      if (ch === '"') inDouble = false;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      continue;
    }
    if (ch === char) return true;
  }
  return false;
}

function extractCommandName(segment: string): string {
  let trimmed = segment.trim();
  trimmed = trimmed.replace(/^\$\(?\s*/, "");
  trimmed = trimmed.replace(/^sudo\s+/, "");
  const match = trimmed.match(/^([A-Za-z][\w.-]*)/);
  return match ? match[1] : trimmed;
}
