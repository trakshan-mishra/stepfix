import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import {
  EntrySchema,
  FlowSchema,
  type Entry,
  type Flow
} from "../src/server/library/schema";
import { lintLibrary, type LintIssue } from "../src/server/library/lint";

function readYamlDir(dirPath: string): { entries: Entry[]; flows: Flow[] } {
  const entries: Entry[] = [];
  const flows: Flow[] = [];
  for (const item of readdirSync(dirPath)) {
    const itemPath = join(dirPath, item);
    if (statSync(itemPath).isDirectory()) {
      const sub = readYamlDir(itemPath);
      entries.push(...sub.entries);
      flows.push(...sub.flows);
      continue;
    }
    if (!item.endsWith(".yaml") && !item.endsWith(".yml")) continue;
    const raw = readFileSync(itemPath, "utf-8");
    const data = parse(raw);
    if (!data) continue;
    if (data.flows) {
      for (const flow of data.flows) flows.push(FlowSchema.parse(flow));
    }
    if (data.scripts) {
      for (const entry of data.scripts) entries.push(EntrySchema.parse(entry));
    }
  }
  return { entries, flows };
}

const libraryDir = new URL("../library/", import.meta.url).pathname;

const { entries, flows } = readYamlDir(libraryDir);

console.log(`Lint: ${entries.length} entries, ${flows.length} flows`);

const issues = lintLibrary(entries, flows);
const errors = issues.filter((i) => i.level === "error");
const infos = issues.filter((i) => i.level === "info");

for (const issue of issues) {
  const prefix = issue.level === "error" ? "ERROR" : "INFO";
  console.log(`  ${prefix} [${issue.rule}] ${issue.id}: ${issue.message}`);
}

console.log("");
console.log(`${errors.length} error(s), ${infos.length} info(s)`);

if (errors.length > 0) {
  process.exit(1);
}
