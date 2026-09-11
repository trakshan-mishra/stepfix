import { useState } from "react";

interface ReportCardProps {
  markdown: string;
  supportEmail: string;
}

export default function ReportCard({
  markdown,
  supportEmail
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
    a.download = "stepfix-report.md";
    a.click();
    URL.revokeObjectURL(url);
  };

  const mailtoHref = `mailto:${supportEmail}?subject=${encodeURIComponent("stepfix support case")}&body=${encodeURIComponent(markdown.slice(0, 2000))}`;

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
      <div className="px-4 py-3 border-b border-gray-100">
        <h3 className="font-medium text-gray-900">Escalation Report</h3>
      </div>
      <div className="px-4 py-3 max-h-64 overflow-y-auto">
        <pre className="text-xs text-gray-700 whitespace-pre-wrap font-mono">
          {markdown}
        </pre>
      </div>
      <div className="px-4 py-3 flex flex-wrap gap-2 border-t border-gray-100">
        <button
          onClick={handleCopy}
          className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 hover:bg-gray-50"
        >
          {copied ? "Copied!" : "Copy"}
        </button>
        <button
          onClick={handleDownload}
          className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 hover:bg-gray-50"
        >
          Download .md
        </button>
        <a
          href={mailtoHref}
          className="px-3 py-1.5 text-sm rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-50"
        >
          Email support
        </a>
      </div>
    </div>
  );
}
