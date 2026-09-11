import { useState, useEffect, useCallback } from "react";
import type {
  CompiledLibrary,
  CompiledEntry
} from "../../server/library/schema";

const RISK_COLORS: Record<string, string> = {
  read_only: "bg-green-100 text-green-800",
  safe_change: "bg-amber-100 text-amber-800",
  restart: "bg-amber-100 text-amber-800",
  disruptive: "bg-red-100 text-red-800"
};

const RISK_LABELS: Record<string, string> = {
  read_only: "READ-ONLY",
  safe_change: "CHANGES A SETTING",
  restart: "RESTARTS SOMETHING",
  disruptive: "DISRUPTIVE"
};

export default function LibraryList() {
  const [data, setData] = useState<CompiledLibrary | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/library")
      .then((r) => r.json())
      .then((d) => setData(d as CompiledLibrary))
      .catch(console.error);
  }, []);

  const filtered = useCallback(
    (entries: CompiledEntry[]) => {
      if (!query.trim()) return entries;
      const q = query.toLowerCase();
      return entries.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.id.toLowerCase().includes(q) ||
          e.explanation.toLowerCase().includes(q) ||
          e.when_to_use.toLowerCase().includes(q)
      );
    },
    [query]
  );

  if (!data) {
    return (
      <div className="flex items-center justify-center h-screen text-gray-400">
        Loading library...
      </div>
    );
  }

  const groups: Record<string, Record<string, CompiledEntry[]>> = {};
  for (const entry of filtered(data.entries)) {
    const osPrefix = entry.id.startsWith("linux")
      ? "Linux"
      : entry.id.startsWith("win")
        ? "Windows"
        : "Common";
    if (!groups[osPrefix]) groups[osPrefix] = {};
    const cat = entry.category;
    if (!groups[osPrefix][cat]) groups[osPrefix][cat] = [];
    groups[osPrefix][cat].push(entry);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-5 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">
            <span className="mr-2">🔧</span>stepfix library
          </h1>
          <a href="/" className="text-sm text-blue-600 hover:underline">
            ← Back to chat
          </a>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-5 py-6">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search scripts by title, id, or description..."
          className="w-full px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-6"
        />

        {data.entries.length === 0 && (
          <p className="text-gray-500">No entries found.</p>
        )}

        {Object.entries(groups).map(([osName, categories]) => (
          <div key={osName} className="mb-8">
            <h2 className="text-lg font-semibold text-gray-700 mb-3">
              {osName}
            </h2>
            {Object.entries(categories).map(([cat, entries]) => (
              <div key={cat} className="mb-4">
                <h3 className="text-sm font-medium text-gray-500 uppercase mb-2">
                  {cat.replace(/_/g, " ")}
                </h3>
                <div className="space-y-2">
                  {entries.map((entry) => (
                    <a
                      key={entry.id}
                      href={`/library/${encodeURIComponent(entry.id)}`}
                      className="block bg-white rounded-lg border border-gray-200 px-4 py-3 hover:border-blue-400 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-gray-900">
                            {entry.title}
                          </span>
                          {entry.draft && (
                            <span className="ml-2 text-xs bg-yellow-100 text-yellow-800 px-1.5 py-0.5 rounded">
                              DRAFT
                            </span>
                          )}
                        </div>
                        <span
                          className={`text-xs px-2 py-0.5 rounded ${RISK_COLORS[entry.risk]}`}
                        >
                          {RISK_LABELS[entry.risk]}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1 font-mono">
                        {entry.id}
                      </p>
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
