import { useState, useEffect } from "react";
import type { CompiledEntry } from "../../server/library/schema";

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

export default function LibraryDetail({ id }: { id: string }) {
  const [entry, setEntry] = useState<CompiledEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/library/${encodeURIComponent(id)}`)
      .then((r) => {
        if (!r.ok) throw new Error("not found");
        return r.json();
      })
      .then((d) => setEntry(d as CompiledEntry))
      .catch((e: Error) => setError(e.message));
  }, [id]);

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 mb-2">Script not found: {id}</p>
          <a href="/library" className="text-blue-600 hover:underline">
            ← Back to library
          </a>
        </div>
      </div>
    );
  }

  if (!entry) {
    return (
      <div className="flex items-center justify-center h-screen text-gray-400">
        Loading...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-5 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">
            <span className="mr-2">🔧</span>
            {entry.title}
          </h1>
          <a href="/library" className="text-sm text-blue-600 hover:underline">
            ← Back to library
          </a>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-5 py-6">
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className={`text-xs px-2 py-0.5 rounded ${RISK_COLORS[entry.risk]}`}
              >
                {RISK_LABELS[entry.risk]}
              </span>
              {entry.needs_admin && (
                <span className="text-xs bg-purple-100 text-purple-800 px-2 py-0.5 rounded">
                  NEEDS ADMIN
                </span>
              )}
              {entry.draft && (
                <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded">
                  DRAFT
                </span>
              )}
              <span className="text-xs text-gray-400 ml-auto">
                v{entry.version} · {entry.hash.slice(0, 16)}...
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-2 font-mono">{entry.id}</p>
          </div>

          {entry.kind === "command" && entry.command && (
            <div className="px-5 py-4 border-b border-gray-100">
              <p className="text-xs font-medium text-gray-500 mb-2">COMMAND</p>
              <pre className="bg-gray-900 text-green-400 rounded-lg p-3 text-sm font-mono overflow-x-auto">
                {entry.command}
              </pre>
              {entry.params && Object.keys(entry.params).length > 0 && (
                <div className="mt-3">
                  <p className="text-xs font-medium text-gray-500 mb-1">
                    PARAMS
                  </p>
                  <dl className="text-sm">
                    {Object.entries(entry.params).map(([name, p]) => (
                      <div key={name} className="mb-1">
                        <dt className="font-mono text-gray-700">
                          {`{{${name}}}`}{" "}
                          <span className="text-gray-400">({p.type})</span>
                        </dt>
                        {p.description && (
                          <dd className="text-gray-500 text-xs ml-4">
                            {p.description}
                          </dd>
                        )}
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </div>
          )}

          {entry.kind === "manual" && entry.manual_steps && (
            <div className="px-5 py-4 border-b border-gray-100">
              <p className="text-xs font-medium text-gray-500 mb-2">STEPS</p>
              <ol className="list-decimal list-inside space-y-1 text-gray-700">
                {entry.manual_steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
              {entry.deep_link && (
                <a
                  href={entry.deep_link}
                  className="inline-block mt-3 text-sm text-blue-600 hover:underline"
                >
                  Open in Settings →
                </a>
              )}
            </div>
          )}

          <div className="px-5 py-4 border-b border-gray-100">
            <details open>
              <summary className="text-sm font-medium text-gray-700 cursor-pointer">
                Why this?
              </summary>
              <p className="text-gray-600 mt-2 leading-relaxed">
                {entry.explanation}
              </p>
            </details>
          </div>

          {entry.expect.length > 0 && (
            <div className="px-5 py-4 border-b border-gray-100">
              <details open>
                <summary className="text-sm font-medium text-gray-700 cursor-pointer">
                  What you should see
                </summary>
                <ul className="mt-2 space-y-1">
                  {entry.expect.map((exp, i) => (
                    <li key={i} className="text-sm text-gray-600">
                      <code className="text-xs bg-gray-100 px-1 rounded">
                        {exp.pattern}
                      </code>
                      {" → "}
                      {exp.meaning}
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          )}

          {entry.undo && (
            <div className="px-5 py-4 border-b border-gray-100">
              <p className="text-xs font-medium text-gray-500 mb-1">UNDO</p>
              <p className="text-sm text-gray-600">{entry.undo}</p>
            </div>
          )}

          {entry.sources.length > 0 && (
            <div className="px-5 py-4">
              <p className="text-xs font-medium text-gray-500 mb-2">SOURCES</p>
              <ul className="space-y-1">
                {entry.sources.map((src, i) => (
                  <li key={i} className="text-sm">
                    <a
                      href={src.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      {src.title}
                    </a>
                    <span className="text-gray-400 ml-2 text-xs">
                      ({src.license})
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
