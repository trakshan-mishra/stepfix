// Production checklist — run before deploy
import { readFileSync, existsSync } from "node:fs";

const checks: Array<{ name: string; pass: boolean; detail?: string }> = [];

function check(name: string, fn: () => boolean, detail?: string) {
  try {
    const pass = fn();
    checks.push({ name, pass, detail });
  } catch {
    checks.push({ name, pass: false, detail: "threw error" });
  }
}

check("library.json exists", () => existsSync("src/generated/library.json"));
check(
  "library.json has no drafts in production",
  () => {
    const lib = JSON.parse(readFileSync("src/generated/library.json", "utf-8"));
    return lib.entries.every((e: { draft?: boolean }) => !e.draft);
  },
  "Run APP_ENV=production npm run compile:library"
);
check(".dev.vars not committed", () => {
  try {
    const gitignore = readFileSync(".gitignore", "utf-8");
    return gitignore.includes(".dev.vars");
  } catch {
    return false;
  }
});
check("migrations directory exists", () =>
  existsSync("migrations/0001_init.sql")
);
check("no key prefixes in source", () => {
  const lib = readFileSync("src/generated/library.json", "utf-8");
  return (
    !lib.includes("gsk_") && !lib.includes("AIza") && !lib.includes("sk-ant")
  );
});
check("wrangler.jsonc exists", () => existsSync("wrangler.jsonc"));

let allPass = true;
for (const c of checks) {
  const status = c.pass ? "PASS" : "FAIL";
  console.log(`  ${status} — ${c.name}${c.detail ? ` (${c.detail})` : ""}`);
  if (!c.pass) allPass = false;
}

console.log("");
if (allPass) {
  console.log("All checks passed. Ready to deploy.");
  process.exit(0);
} else {
  console.log("Some checks failed. Fix them before deploying.");
  process.exit(1);
}
