// TODO M1: lint-library — implement every rule in 05-script-library.md §5
// Run with: npm run lint:library
import { readdirSync } from "node:fs";

const libraryDir = new URL("../library/", import.meta.url);
const files = readdirSync(libraryDir).filter((f) => f.endsWith(".yaml"));
console.log(`Library lint: found ${files.length} YAML files`);
console.log("TODO: implement lint rules per 05-script-library.md §5");
