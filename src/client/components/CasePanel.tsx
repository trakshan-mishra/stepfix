import type { CaseFile, Step } from "../../server/agent/case-file";

interface CasePanelProps {
  caseFile: CaseFile;
  steps: Step[];
  phase: string;
  onDeleteSession: () => void;
}

const STATUS_ICONS: Record<string, string> = {
  pending: "…",
  ran: "✓",
  worked: "✓",
  failed: "✗",
  cant_run: "⊘",
  skipped: "→"
};

export default function CasePanel({
  caseFile,
  steps,
  phase,
  onDeleteSession
}: CasePanelProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 w-72 shrink-0 h-fit sticky top-4">
      <h2 className="text-sm font-semibold text-gray-700 mb-3">Case</h2>
      <dl className="space-y-1 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-gray-500">Phase</dt>
          <dd className="text-gray-700 text-right capitalize">{phase}</dd>
        </div>
        {caseFile.os !== "unknown" && (
          <div className="flex justify-between gap-4">
            <dt className="text-gray-500">OS</dt>
            <dd className="text-gray-700 text-right">
              {caseFile.os}
              {caseFile.osVersion && caseFile.osVersion !== "unknown"
                ? " " + caseFile.osVersion
                : ""}
            </dd>
          </div>
        )}
        {caseFile.category && (
          <div className="flex justify-between gap-4">
            <dt className="text-gray-500">Problem</dt>
            <dd className="text-gray-700 text-right capitalize">
              {caseFile.category}
            </dd>
          </div>
        )}
        {caseFile.whenStarted && (
          <div className="flex justify-between gap-4">
            <dt className="text-gray-500">Started</dt>
            <dd className="text-gray-700 text-right">{caseFile.whenStarted}</dd>
          </div>
        )}
      </dl>

      {steps.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-medium text-gray-500 uppercase mb-2">
            Steps
          </h3>
          <ol className="space-y-1 text-sm">
            {steps.map((s, i) => (
              <li key={s.stepId} className="flex items-start gap-2">
                <span className="text-gray-400 shrink-0">{i + 1}.</span>
                <span className="text-gray-400 shrink-0">
                  {STATUS_ICONS[s.status] ?? "?"}
                </span>
                <span className="text-gray-600 truncate">{s.scriptId}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="mt-4 pt-4 border-t border-gray-100">
        <button
          onClick={onDeleteSession}
          className="text-sm text-red-600 hover:underline"
        >
          Delete my session
        </button>
      </div>
    </div>
  );
}
