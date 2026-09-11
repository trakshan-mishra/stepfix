// TODO M1: compile-library — validate with zod, compute sha256, write src/generated/library.json
// Run with: npm run compile:library
import { mkdirSync, existsSync } from "node:fs";

const outDir = new URL("../src/generated/", import.meta.url);
if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}
console.log("Library compile: output dir ready");
console.log("TODO: implement compilation per 03-architecture.md §5.3");
