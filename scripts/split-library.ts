import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { parse, stringify } from "yaml";

interface Entry {
  id: string;
  category: string;
  os: string[];
  [key: string]: unknown;
}

interface SeedFile {
  flows: Array<{ os_family: string; category: string; entry: string }>;
  scripts: Entry[];
}

const seedPath = new URL("../seed/script-library.yaml", import.meta.url);
const libraryDir = new URL("../library/", import.meta.url);

const raw = readFileSync(seedPath, "utf-8");
const data = parse(raw) as SeedFile;

mkdirSync(new URL("linux", libraryDir), { recursive: true });
mkdirSync(new URL("windows", libraryDir), { recursive: true });
mkdirSync(new URL("common", libraryDir), { recursive: true });

const flowsContent =
  "# flows.yaml — entry points for the playbook engine\n" +
  "# See spec/05-script-library.md §4.\n\n" +
  stringify({ flows: data.flows });
writeFileSync(new URL("flows.yaml", libraryDir), flowsContent);
console.log(`  flows.yaml — ${data.flows.length} flows`);

const files: Record<string, Entry[]> = {};

for (const entry of data.scripts) {
  const id = entry.id;
  let dir: string;
  let cat = entry.category;

  if (id.startsWith("linux.")) {
    dir = "linux";
  } else if (id.startsWith("win.")) {
    dir = "windows";
  } else if (id.startsWith("common.")) {
    dir = "common";
    cat = "dev-cli";
  } else if (id.startsWith("manual.linux.")) {
    dir = "linux";
  } else if (id.startsWith("manual.win.")) {
    dir = "windows";
  } else if (id.startsWith("manual.")) {
    dir = "common";
    cat = "manual";
  } else {
    throw new Error(`Unknown id prefix: ${id}`);
  }

  const fileCat = cat.replace(/_/g, "-");
  const key = `${dir}/${fileCat}`;
  if (!files[key]) files[key] = [];
  files[key].push(entry);
}

for (const [key, entries] of Object.entries(files)) {
  const header =
    `# ${key}.yaml — ${entries.length} entries\n` +
    `# Part of the stepfix script library. See spec/05-script-library.md for schema.\n` +
    `# reviewed_by: null on all entries — run on a real machine before setting.\n\n`;

  const body = stringify({ scripts: entries }, { lineWidth: 0, indent: 2 });
  writeFileSync(new URL(`${key}.yaml`, libraryDir), header + body);
  console.log(`  ${key}.yaml — ${entries.length} entries`);
}

console.log("Split complete.");
