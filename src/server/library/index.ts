import type { CompiledLibrary, CompiledEntry, RiskLevel } from "./schema";
import { renderCommand } from "./render";

import libraryData from "../../generated/library.json";

const library = libraryData as CompiledLibrary;

const entryMap = new Map<string, CompiledEntry>(
  library.entries.map((e) => [e.id, e])
);

export function getScript(id: string): CompiledEntry | undefined {
  return entryMap.get(id);
}

export function getAllScripts(): CompiledEntry[] {
  return library.entries;
}

export function getFlows() {
  return library.flows;
}

export function catalogFor(os: string, category: string): CompiledEntry[] {
  return library.entries.filter(
    (e) => e.category === category && e.os.includes(os)
  );
}

export { renderCommand };
export { libraryData };
export type { CompiledEntry, RiskLevel };
