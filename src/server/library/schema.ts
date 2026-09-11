import { z } from "zod";

export const RiskLevel = z.enum([
  "read_only",
  "safe_change",
  "restart",
  "disruptive"
]);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const Shell = z.enum(["bash", "powershell", "cmd", "gui", "any"]);
export type Shell = z.infer<typeof Shell>;

export const Kind = z.enum(["command", "manual"]);
export type Kind = z.infer<typeof Kind>;

export const ParamSchema = z.object({
  type: z.enum(["enum", "regex"]),
  description: z.string().optional(),
  values: z.array(z.string()).optional(),
  pattern: z.string().optional()
});
export type Param = z.infer<typeof ParamSchema>;

export const ExpectSchema = z.object({
  pattern: z.string(),
  meaning: z.string()
});
export type Expect = z.infer<typeof ExpectSchema>;

export const NextConditionSchema = z.object({
  output_matches: z.string().optional(),
  output_empty: z.boolean().optional(),
  status: z.enum(["worked", "failed", "cant_run"]).optional()
});
export type NextCondition = z.infer<typeof NextConditionSchema>;

export const NextRuleSchema = z.union([
  z.object({
    when: NextConditionSchema,
    goto: z.string()
  }),
  z.object({
    default: z.string()
  })
]);
export type NextRule = z.infer<typeof NextRuleSchema>;

export const SourceSchema = z.object({
  title: z.string(),
  url: z.string(),
  license: z.string()
});
export type Source = z.infer<typeof SourceSchema>;

export const EntrySchema = z.object({
  id: z.string(),
  version: z.number().int().positive(),
  title: z.string(),
  kind: Kind,
  os: z.array(z.string()),
  shell: Shell,
  category: z.string(),
  risk: RiskLevel,
  needs_admin: z.boolean(),
  command: z.string().optional(),
  params: z.record(z.string(), ParamSchema).optional(),
  manual_steps: z.array(z.string()).optional(),
  deep_link: z.string().nullable().optional(),
  compound: z.boolean().optional(),
  when_to_use: z.string(),
  explanation: z.string(),
  expect: z.array(ExpectSchema),
  next: z.array(NextRuleSchema),
  undo: z.string().nullable(),
  verifies: z.array(z.string()).optional(),
  sources: z.array(SourceSchema),
  reviewed_by: z.string().nullable(),
  tested_on: z.array(z.string())
});
export type Entry = z.infer<typeof EntrySchema>;

export const FlowSchema = z.object({
  os_family: z.string(),
  category: z.string(),
  entry: z.string()
});
export type Flow = z.infer<typeof FlowSchema>;

export const CompiledEntrySchema = EntrySchema.extend({
  hash: z.string(),
  draft: z.boolean()
});
export type CompiledEntry = z.infer<typeof CompiledEntrySchema>;

export const CompiledLibrarySchema = z.object({
  version: z.literal(1),
  compiledAt: z.string(),
  entries: z.array(CompiledEntrySchema),
  flows: z.array(FlowSchema)
});
export type CompiledLibrary = z.infer<typeof CompiledLibrarySchema>;

export const SPECIAL_TARGETS = new Set(["RESOLVED", "ESCALATE", "FLOW_ENTRY"]);

export const ID_PATTERN =
  /^(linux|win|mac|common|manual)\.[a-z_]+\.[a-z0-9_]+$|^manual\.[a-z0-9_.]+$/;

export const PIPE_ALLOWLIST = new Set([
  "grep",
  "head",
  "tail",
  "tr",
  "sort",
  "uniq",
  "wc",
  "Select-String",
  "Select-Object",
  "Format-Table",
  "Format-List",
  "Where-Object",
  "Measure-Object"
]);

export const FORBIDDEN_PATTERNS: Array<{ name: string; pattern: RegExp }> = [
  {
    name: "download-and-execute (curl|sh)",
    pattern: /curl\s.*\|\s*(sh|bash|zsh)/i
  },
  {
    name: "download-and-execute (wget|sh)",
    pattern: /wget\s.*\|\s*(sh|bash|zsh)/i
  },
  {
    name: "download-and-execute (iwr|iex)",
    pattern: /(iwr|Invoke-WebRequest)\s.*\|\s*(iex|Invoke-Expression)/i
  },
  {
    name: "Invoke-Expression",
    pattern: /Invoke-Expression/i
  },
  {
    name: "iex",
    pattern: /\biex\b/i
  },
  {
    name: "DownloadString",
    pattern: /DownloadString/i
  },
  {
    name: "DownloadFile",
    pattern: /DownloadFile/i
  },
  {
    name: "Start-BitsTransfer",
    pattern: /Start-BitsTransfer/i
  },
  {
    name: "certutil urlcache",
    pattern: /certutil\s.*-urlcache/i
  },
  {
    name: "encodedcommand",
    pattern: /-enc(odedcommand)?\b/i
  },
  {
    name: "FromBase64String",
    pattern: /FromBase64String/i
  },
  {
    name: "base64 decode",
    pattern: /base64\s+(-d|--decode)/i
  },
  {
    name: "xxd -r",
    pattern: /\bxxd\s+-r/i
  },
  {
    name: "char() obfuscation",
    pattern: /char\(\d+\)/i
  },
  {
    name: "windowstyle hidden",
    pattern: /-w(indowstyle)?\s+hidden/i
  },
  {
    name: "nohup",
    pattern: /\bnohup\b/i
  },
  {
    name: "trailing & (background)",
    pattern: /&\s*$/
  },
  {
    name: "disown",
    pattern: /\bdisown\b/i
  },
  {
    name: "redirect to /dev/null (whole command)",
    pattern: />\s*\/dev\/null/
  },
  {
    name: "rm -r",
    pattern: /\brm\s+-r/i
  },
  {
    name: "rm -f /",
    pattern: /\brm\s+-rf?\s+\//i
  },
  {
    name: "del /s",
    pattern: /\bdel\s+\/s/i
  },
  {
    name: "rd /s",
    pattern: /\brd\s+\/s/i
  },
  {
    name: "Remove-Item -Recurse",
    pattern: /Remove-Item\s.*-Recurse/i
  },
  {
    name: "format",
    pattern: /\bformat\s/i
  },
  {
    name: "mkfs",
    pattern: /\bmkfs\b/i
  },
  {
    name: "dd if=",
    pattern: /\bdd\s+if=/i
  },
  {
    name: "diskpart",
    pattern: /\bdiskpart\b/i
  },
  {
    name: "bcdedit",
    pattern: /\bbcdedit\b/i
  },
  {
    name: "reg delete/add",
    pattern: /\breg\s+(delete|add)\b/i
  },
  {
    name: "Set-ItemProperty HKLM",
    pattern: /Set-ItemProperty\s.*HKLM/i
  },
  {
    name: "chmod -R",
    pattern: /\bchmod\s+-R/i
  },
  {
    name: "chown -R",
    pattern: /\bchown\s+-R/i
  },
  {
    name: "fork bomb pattern",
    pattern: /:\(\)\s*\{/
  },
  {
    name: "write to /dev/sd",
    pattern: />\s*\/dev\/sd/i
  },
  {
    name: "wipefs",
    pattern: /\bwipefs\b/i
  },
  {
    name: "shred",
    pattern: /\bshred\b/i
  },
  {
    name: "Set-ExecutionPolicy",
    pattern: /Set-ExecutionPolicy/i
  },
  {
    name: "Set-MpPreference",
    pattern: /Set-MpPreference/i
  },
  {
    name: "Add-MpPreference",
    pattern: /Add-MpPreference/i
  },
  {
    name: "setenforce 0",
    pattern: /\bsetenforce\s+0\b/i
  },
  {
    name: "ufw disable",
    pattern: /\bufw\s+disable/i
  },
  {
    name: "netsh advfirewall off",
    pattern: /netsh\s+advfirewall\s+set\s.*\bstate\s+off/i
  },
  {
    name: "mshta",
    pattern: /\bmshta\b/i
  },
  {
    name: "rundll32",
    pattern: /\brundll32\b/i
  },
  {
    name: "regsvr32",
    pattern: /\bregsvr32\b/i
  },
  {
    name: "wmic process call create",
    pattern: /wmic\s+process\s+call\s+create/i
  },
  {
    name: "schtasks /create",
    pattern: /schtasks\s+\/create/i
  },
  {
    name: "bitsadmin",
    pattern: /\bbitsadmin\b/i
  }
];
