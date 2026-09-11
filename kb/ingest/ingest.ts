// kb/ingest/ingest.ts — KB ingestion script
// Run with: npx tsx kb/ingest/ingest.ts
// Requires CF_ACCOUNT_ID and CF_API_TOKEN in kb/.env
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { parse } from "yaml";
import { join } from "node:path";

interface KbSource {
  id: string;
  url: string;
  license: string;
  use: string;
  os?: string[];
  category?: string[];
  attribution?: string;
  notes?: string;
}

interface KbChunk {
  id: string;
  source: string;
  url: string;
  license: string;
  title: string;
  heading_path: string;
  os: string;
  category: string;
  text: string;
  updated_at: number;
}

const sourcesPath = new URL("../sources.yaml", import.meta.url).pathname;
const sourcesRaw = readFileSync(sourcesPath, "utf-8");
const sourcesData = parse(sourcesRaw) as { sources: KbSource[] };
const ingestSources = sourcesData.sources.filter((s) => s.use === "ingest");

console.log(`KB ingest: ${ingestSources.length} sources to ingest`);

function chunkId(url: string, headingPath: string): string {
  return createHash("sha256")
    .update(url + "|" + headingPath)
    .digest("hex")
    .slice(0, 32);
}

function chunkByHeading(
  text: string,
  url: string,
  source: KbSource
): KbChunk[] {
  const lines = text.split("\n");
  const chunks: KbChunk[] = [];
  let currentHeading = "";
  let currentText: string[] = [];

  for (const line of lines) {
    if (line.startsWith("#")) {
      if (currentText.join("\n").trim().length > 100) {
        const text = currentText.join("\n").trim();
        if (text.length <= 700 * 4) {
          chunks.push({
            id: chunkId(url, currentHeading),
            source: source.id,
            url,
            license: source.license,
            title: source.id,
            heading_path: currentHeading,
            os: (source.os ?? []).join(","),
            category: (source.category ?? []).join(","),
            text,
            updated_at: Date.now()
          });
        }
      }
      currentHeading = line.replace(/^#+\s*/, "");
      currentText = [];
    } else {
      currentText.push(line);
    }
  }

  if (currentText.join("\n").trim().length > 100) {
    const text = currentText.join("\n").trim();
    chunks.push({
      id: chunkId(url, currentHeading),
      source: source.id,
      url,
      license: source.license,
      title: source.id,
      heading_path: currentHeading,
      os: (source.os ?? []).join(","),
      category: (source.category ?? []).join(","),
      text,
      updated_at: Date.now()
    });
  }

  return chunks;
}

console.log("This script fetches, chunks, embeds, and upserts KB sources.");
console.log("It requires CF_ACCOUNT_ID and CF_API_TOKEN in kb/.env.");
console.log("Run it locally — never in the Worker.");
console.log("TODO: implement fetch + embed + upsert for each source.");
