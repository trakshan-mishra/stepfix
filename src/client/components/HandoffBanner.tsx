interface HandoffBannerProps {
  summary: string;
}

export default function HandoffBanner({ summary }: HandoffBannerProps) {
  return (
    <div className="border border-blue-200 rounded-lg bg-blue-50 px-4 py-3 mb-3">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-blue-600 font-medium text-sm">
          Step-by-step fixing
        </span>
      </div>
      <p className="text-sm text-gray-700">{summary}</p>
    </div>
  );
}
