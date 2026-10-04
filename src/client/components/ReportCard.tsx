import { useState } from "react";

interface ReportCardProps {
  markdown: string;
  supportEmail?: string;
  title?: string;
  // null hides the note
  note?: string | null;
  filename?: string;
}

const ESCALATION_NOTE =
  "Nobody has been notified automatically. Copy or download this and send it to someone you trust to help.";

export default function ReportCard({
  markdown,
  supportEmail,
  title = "Escalation Report",
  note = ESCALATION_NOTE,
  filename = "stepfix-report.md"
}: ReportCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(markdown).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleDownload = () => {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const mailtoHref = supportEmail
    ? `mailto:${supportEmail}?subject=${encodeURIComponent("stepfix support case")}&body=${encodeURIComponent(markdown.slice(0, 2000))}`
    : undefined;

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      <div className="px-4 py-3 border-b border-gray-100">
        <h3 className="font-medium text-gray-900">{title}</h3>
      </div>
      <div className="px-4 py-3 max-h-64 overflow-y-auto">
        <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono">
          {markdown}
        </pre>
      </div>
      {note && (
        <p className="px-4 pt-3 text-sm text-gray-700 border-t border-gray-100">
          {note}
        </p>
      )}
      <div className="px-4 py-3 flex flex-wrap gap-2 border-t border-gray-100">
        <button
          onClick={handleCopy}
          className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
        <button
          onClick={handleDownload}
          className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50"
        >
          Download .md
        </button>
        {mailtoHref && (
          <a
            href={mailtoHref}
            className="px-3 py-1.5 text-sm rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-50"
          >
            Email support
          </a>
        )}
      </div>
    </div>
  );
}
