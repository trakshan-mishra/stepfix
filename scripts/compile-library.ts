import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync
} from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { parse } from "yaml";
import {
  EntrySchema,
  FlowSchema,
  type Entry,
  type Flow,
  type CompiledLibrary
} from "../src/server/library/schema";

function readYamlDir(dirPath: string): { entries: Entry[]; flows: Flow[] } {
  const entries: Entry[] = [];
  const flows: Flow[] = [];
  const items = readdirSync(dirPath);

  for (const item of items) {
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
      for (const flow of data.flows) {
        flows.push(FlowSchema.parse(flow));
      }
    }
    if (data.scripts) {
      for (const entry of data.scripts) {
        entries.push(EntrySchema.parse(entry));
      }
    }
  }

  return { entries, flows };
}

function computeHash(entry: Entry): string {
  const parts = [
    entry.command ?? "",
    JSON.stringify(entry.params ?? {}),
    entry.explanation,
    entry.undo ?? ""
  ].join("|");
  return "sha256:" + createHash("sha256").update(parts).digest("hex");
}

const isProduction =
  (process.env.APP_ENV as string | undefined) === "production";
const libraryDir = new URL("../library/", import.meta.url);
const outDir = new URL("../src/generated/", import.meta.url);

const libraryPath = new URL("../library/", import.meta.url).pathname;

console.log("Compiling script library...");
console.log(`  Mode: ${isProduction ? "production" : "dev"}`);

const { entries, flows } = readYamlDir(libraryPath);
console.log(`  Read ${entries.length} entries, ${flows.length} flows`);

if (isProduction) {
  const unreviewed = entries.filter((e) => !e.reviewed_by);
  if (unreviewed.length > 0) {
    console.error(
      `ERROR: ${unreviewed.length} entries have reviewed_by: null in production mode:`
    );
    for (const e of unreviewed) {
      console.error(`  ${e.id}`);
    }
    process.exit(1);
  }
}

const compiled: CompiledLibrary = {
  version: 1,
  compiledAt: new Date().toISOString().split(".")[0] + "Z",
  entries: entries.map((e) => ({
    ...e,
    hash: computeHash(e),
    draft: !e.reviewed_by
  })),
  flows
};

mkdirSync(outDir, { recursive: true });
const outPath = new URL("library.json", outDir);

const draftCount = compiled.entries.filter((e) => e.draft).length;
let unchanged = false;
try {
  const existing = JSON.parse(
    readFileSync(outPath, "utf-8")
  ) as Partial<CompiledLibrary>;
  unchanged =
    existing.version === compiled.version &&
    JSON.stringify(existing.entries) === JSON.stringify(compiled.entries);
} catch {
  // Missing or invalid output is regenerated below.
}

console.log(
  `  Compiled ${compiled.entries.length} entries (${draftCount} drafts)`
);
if (unchanged) {
  console.log(`  Unchanged src/generated/library.json`);
} else {
  writeFileSync(outPath, JSON.stringify(compiled, null, 2) + "\n");
  console.log(`  Written to src/generated/library.json`);
}
