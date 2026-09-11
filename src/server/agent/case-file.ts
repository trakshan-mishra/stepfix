import { z } from "zod";

export const Os = z.enum([
  "windows11",
  "windows10",
  "ubuntu",
  "debian",
  "linux_other",
  "macos",
  "unknown"
]);
export type Os = z.infer<typeof Os>;

export const Category = z.enum(["bluetooth", "wifi", "dev_cli", "other"]);
export type Category = z.infer<typeof Category>;

export const Fact = z.object({
  key: z.string().max(60),
  value: z.string().max(500),
  source: z.enum(["user", "output", "screenshot", "kb"]),
  at: z.number()
});
export type Fact = z.infer<typeof Fact>;

export const CaseFile = z.object({
  os: Os.default("unknown"),
  osVersion: z.string().max(40).optional(),
  device: z.string().max(80).optional(),
  category: Category.optional(),
  symptom: z.string().max(300).optional(),
  errorText: z.string().max(500).optional(),
  whenStarted: z.string().max(120).optional(),
  whatChanged: z.string().max(200).optional(),
  userSkill: z.enum(["novice", "intermediate", "expert"]).optional(),
  canUseAdmin: z.boolean().optional(),
  facts: z.array(Fact).max(50).default([]),
  summary: z.string().max(400).optional()
});
export type CaseFile = z.infer<typeof CaseFile>;

export function missingForHandoff(c: CaseFile): string[] {
  const missing: string[] = [];
  if (c.os === "unknown") missing.push("os");
  if (!c.category) missing.push("category");
  if (!c.symptom) missing.push("symptom");
  if (!c.errorText && !c.whenStarted && !c.whatChanged) {
    missing.push("errorText|whenStarted|whatChanged");
  }
  return missing;
}

export const StepStatus = z.enum([
  "pending",
  "ran",
  "worked",
  "failed",
  "cant_run",
  "skipped"
]);
export type StepStatus = z.infer<typeof StepStatus>;

export const Step = z.object({
  stepId: z.string(),
  scriptId: z.string(),
  scriptVersion: z.number(),
  params: z.record(z.string(), z.string()).default({}),
  renderedCommand: z.string().optional(),
  whyNow: z.string().max(300),
  status: StepStatus,
  output: z.string().max(8000).optional(),
  matchedPatterns: z.array(z.string()).default([]),
  createdAt: z.number(),
  updatedAt: z.number(),
  source: z.enum(["llm", "playbook"])
});
export type Step = z.infer<typeof Step>;

export const Phase = z.enum([
  "support",
  "technician",
  "resolved",
  "escalated",
  "closed"
]);
export type Phase = z.infer<typeof Phase>;

export const Card = z.object({
  stepId: z.string(),
  scriptId: z.string(),
  version: z.number(),
  hash: z.string(),
  title: z.string(),
  os: z.string(),
  shell: z.string(),
  risk: z.string(),
  needsAdmin: z.boolean(),
  kind: z.string(),
  command: z.string().optional(),
  manualSteps: z.array(z.string()).optional(),
  deepLink: z.string().optional(),
  explanation: z.string(),
  expect: z.array(z.object({ pattern: z.string(), meaning: z.string() })),
  undo: z.string().optional(),
  sources: z.array(
    z.object({ title: z.string(), url: z.string(), license: z.string() })
  ),
  whyNow: z.string()
});
export type Card = z.infer<typeof Card>;
