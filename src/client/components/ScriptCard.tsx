import { useState } from "react";
import type { Card } from "../../server/agent/case-file";

const RISK_STYLES: Record<string, { bg: string; text: string; label: string }> =
  {
    read_only: {
      bg: "bg-green-100",
      text: "text-green-800",
      label: "READ-ONLY"
    },
    safe_change: {
      bg: "bg-amber-100",
      text: "text-amber-800",
      label: "CHANGES A SETTING"
    },
    restart: {
      bg: "bg-amber-100",
      text: "text-amber-800",
      label: "RESTARTS SOMETHING"
    },
    disruptive: { bg: "bg-red-100", text: "text-red-800", label: "DISRUPTIVE" }
  };

interface ScriptCardProps {
  card: Card;
  onResult: (
    stepId: string,
    status: "ran" | "worked" | "failed" | "cant_run",
    output?: string
  ) => void;
  collapsed?: boolean;
}

export default function ScriptCard({
  card,
  onResult,
  collapsed
}: ScriptCardProps) {
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [copied, setCopied] = useState(false);
  const [resultSent, setResultSent] = useState(false);

  const risk = RISK_STYLES[card.risk] ?? RISK_STYLES.read_only;
  const isDisruptive = card.risk === "disruptive";
  const canCopy = !isDisruptive || understood;
  const isManual = card.kind === "manual";

  const handleCopy = () => {
    if (!canCopy || !card.command) return;
    navigator.clipboard.writeText(card.command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const sendResult = (
    status: "ran" | "worked" | "failed" | "cant_run",
    output?: string
  ) => {
    if (resultSent) return;
    setResultSent(true);
    onResult(card.stepId, status, output);
  };

  const handlePasteSubmit = () => {
    sendResult("ran", pasteText.trim() || undefined);
    setShowPaste(false);
    setPasteText("");
  };

  if (collapsed || resultSent) {
    return (
      <div className="border border-gray-200 rounded-lg px-4 py-2 bg-gray-50">
        <span className="text-sm text-gray-500">{card.title}</span>
        <span className="ml-2 text-xs text-gray-400">· result recorded</span>
      </div>
    );
  }

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      <div className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-gray-900">{card.title}</span>
          <span
            className={`text-xs px-2 py-0.5 rounded ${risk.bg} ${risk.text}`}
          >
            {risk.label}
          </span>
          {card.needsAdmin && (
            <span className="text-xs bg-purple-100 text-purple-800 px-2 py-0.5 rounded">
              NEEDS ADMIN
            </span>
          )}
          <span className="text-xs text-gray-400 ml-auto">
            {card.os} · {card.shell}
          </span>
        </div>
      </div>

      {isManual ? (
        <div className="px-4 py-3 border-b border-gray-100">
          <ol className="list-decimal list-inside space-y-1 text-gray-700 text-sm">
            {card.manualSteps?.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          {card.deepLink && (
            <a
              href={card.deepLink}
              className="inline-block mt-3 text-sm text-blue-600 hover:underline"
            >
              Open in Settings →
            </a>
          )}
        </div>
      ) : (
        <div className="px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <pre className="bg-gray-900 text-green-400 rounded-lg p-3 text-sm font-mono flex-1 overflow-x-auto">
              {card.command}
            </pre>
            <button
              onClick={handleCopy}
              disabled={!canCopy}
              className="px-3 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          {isDisruptive && !understood && (
            <label className="flex items-center gap-2 mt-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={understood}
                onChange={(e) => setUnderstood(e.target.checked)}
              />
              I understand this may disconnect me or needs a restart
            </label>
          )}
          {card.needsAdmin && (
            <p className="text-xs text-gray-500 mt-2">
              {card.os.includes("windows")
                ? "Open Terminal as administrator (right-click → Run as administrator)."
                : "The command includes sudo; enter your password when prompted."}
            </p>
          )}
        </div>
      )}

      <div className="px-4 py-2 border-b border-gray-100">
        <details>
          <summary className="text-sm font-medium text-gray-700 cursor-pointer">
            Why this?
          </summary>
          <p className="text-gray-600 mt-2 leading-relaxed text-sm">
            {card.explanation}
          </p>
        </details>
      </div>

      {card.expect.length > 0 && (
        <div className="px-4 py-2 border-b border-gray-100">
          <details>
            <summary className="text-sm font-medium text-gray-700 cursor-pointer">
              What you should see
            </summary>
            <ul className="mt-2 space-y-1">
              {card.expect.map((exp, i) => (
                <li key={i} className="text-sm text-gray-600">
                  <code className="text-xs bg-gray-100 px-1 rounded">
                    {exp.pattern}
                  </code>{" "}
                  → {exp.meaning}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}

      {card.undo && (
        <div className="px-4 py-2 border-b border-gray-100">
          <p className="text-xs text-gray-500">
            Undo: <span className="text-gray-600">{card.undo}</span>
          </p>
        </div>
      )}

      <div className="px-4 py-3 flex flex-wrap gap-2">
        {!showPaste ? (
          <>
            <button
              onClick={() => setShowPaste(true)}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
            >
              Paste output
            </button>
            <button
              onClick={() => sendResult("worked")}
              className="px-3 py-1.5 text-sm rounded-lg border border-green-300 text-green-700 hover:bg-green-50"
            >
              It worked
            </button>
            <button
              onClick={() => sendResult("failed")}
              className="px-3 py-1.5 text-sm rounded-lg border border-red-300 text-red-700 hover:bg-red-50"
            >
              Didn't work
            </button>
            <button
              onClick={() => sendResult("cant_run")}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50"
            >
              I can't run this
            </button>
          </>
        ) : (
          <div className="w-full">
            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder="Paste the command output here..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono h-24 resize-none"
            />
            <div className="flex gap-2 mt-2">
              <button
                onClick={handlePasteSubmit}
                className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700"
              >
                Send output
              </button>
              <button
                onClick={() => {
                  setShowPaste(false);
                  setPasteText("");
                }}
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {card.sources.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-100">
          <p className="text-xs text-gray-400">
            From the public library · v{card.version} ·{" "}
            <a
              href={`/library/${encodeURIComponent(card.scriptId)}`}
              className="text-blue-600 hover:underline"
            >
              view
            </a>
          </p>
        </div>
      )}
    </div>
  );
}
