export interface KbResult {
  id: string;
  title: string;
  snippet: string;
  url: string;
  license: string;
  source: string;
  score: number;
}

const FTS_SPECIAL = /["\-:*()^]/g;
const FTS_KEYWORDS = /\b(NEAR|AND|OR|NOT)\b/gi;

export function sanitizeFts(query: string): string {
  let cleaned = query.replace(FTS_SPECIAL, " ");
  cleaned = cleaned.replace(FTS_KEYWORDS, "");
  const words = cleaned.match(/[\p{L}\p{N}_]+/gu) ?? [];
  const quoted = words.map((w) => `"${w}"`);
  if (quoted.length === 0) return "";
  return quoted.join(" ");
}

export function sanitizeFtsOr(query: string): string {
  let cleaned = query.replace(FTS_SPECIAL, " ");
  cleaned = cleaned.replace(FTS_KEYWORDS, "");
  const words = cleaned.match(/[\p{L}\p{N}_]+/gu) ?? [];
  const quoted = words.map((w) => `"${w}"`);
  if (quoted.length === 0) return "";
  return quoted.join(" OR ");
}

export function rrf(
  lexical: Array<{ id: string; score: number }>,
  semantic: Array<{ id: string; score: number }>,
  k: number = 60
): Array<{ id: string; score: number }> {
  const scores = new Map<string, number>();

  lexical.forEach((item, rank) => {
    const current = scores.get(item.id) ?? 0;
    scores.set(item.id, current + 1 / (k + rank + 1));
  });

  semantic.forEach((item, rank) => {
    const current = scores.get(item.id) ?? 0;
    scores.set(item.id, current + 1 / (k + rank + 1));
  });

  return [...scores.entries()]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score);
}

export function makeSnippet(text: string, maxLen: number = 700): string {
  if (text.length <= maxLen) return text;
  const half = Math.floor(maxLen / 2);
  return text.slice(0, half) + " [...] " + text.slice(-half);
}

export async function searchKb(
  query: string,
  db: D1Database,
  vectors: VectorizeIndex | undefined,
  opts?: {
    os?: string;
    category?: string;
    timeoutMs?: number;
    useSemantic?: boolean;
  }
): Promise<KbResult[]> {
  const timeoutMs = opts?.timeoutMs ?? 2500;
  const ftsQuery = sanitizeFts(query);

  if (!ftsQuery) return [];

  let ftsQueryFinal = ftsQuery;
  let lexicalRows: Array<{
    id: string;
    title: string;
    url: string;
    license: string;
    source: string;
    text: string;
    score: number;
  }> = [];

  try {
    const stmt = db.prepare(
      `SELECT kb_chunks.id, kb_chunks.title, kb_chunks.url, kb_chunks.license, kb_chunks.source, kb_chunks.text,
              bm25(kb_fts) AS score
       FROM kb_fts
       JOIN kb_chunks ON kb_chunks.rowid = kb_fts.rowid
       WHERE kb_fts MATCH ?
       ORDER BY score
       LIMIT 20`
    );
    lexicalRows = (await stmt.bind(ftsQueryFinal).all())
      .results as unknown as typeof lexicalRows;

    if (lexicalRows.length < 3) {
      const orQuery = sanitizeFtsOr(query);
      if (orQuery) {
        const stmt2 = db.prepare(
          `SELECT kb_chunks.id, kb_chunks.title, kb_chunks.url, kb_chunks.license, kb_chunks.source, kb_chunks.text,
                  bm25(kb_fts) AS score
           FROM kb_fts
           JOIN kb_chunks ON kb_chunks.rowid = kb_fts.rowid
           WHERE kb_fts MATCH ?
           ORDER BY score
           LIMIT 20`
        );
        lexicalRows = (await stmt2.bind(orQuery).all())
          .results as unknown as typeof lexicalRows;
      }
    }
  } catch {
    return [];
  }

  const lexical = lexicalRows.map((r) => ({ id: r.id, score: r.score }));

  let semantic: Array<{ id: string; score: number }> = [];
  if (opts?.useSemantic !== false && vectors && lexical.length < 3) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const queryVector = await embedQuery(query, ctrl.signal);
      clearTimeout(timer);

      if (queryVector) {
        const filter: Record<string, string> = {};
        if (opts?.os) filter.os = opts.os;
        if (opts?.category) filter.category = opts.category;

        const vecResults = await vectors.query(queryVector, {
          topK: 20,
          filter: filter
        });

        semantic = vecResults.matches.map((m, i) => ({
          id: m.id,
          score: 1 / (i + 1)
        }));
      }
    } catch {
      // timeout or error — keyword-only fallback
    }
  }

  const fused = rrf(lexical, semantic);

  const resultMap = new Map(lexicalRows.map((r) => [r.id, r]));
  const results: KbResult[] = [];

  for (const { id, score } of fused.slice(0, 5)) {
    const row = resultMap.get(id);
    if (row) {
      results.push({
        id: row.id,
        title: row.title,
        snippet: makeSnippet(row.text),
        url: row.url,
        license: row.license,
        source: row.source,
        score
      });
    }
  }

  return results;
}

async function embedQuery(
  _query: string,
  _signal: AbortSignal
): Promise<number[] | null> {
  return null;
}
