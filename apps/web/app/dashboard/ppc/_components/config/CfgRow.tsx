export function CfgRow({
  label,
  hint,
  last,
  children,
}: {
  label: string;
  hint?: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`grid grid-cols-1 gap-2 py-3 sm:grid-cols-[220px_1fr] sm:gap-4 sm:items-start ${
        last ? "" : "border-b border-neutral-100"
      }`}
    >
      <div>
        <div className="text-[13px] font-medium text-ink">{label}</div>
        {hint && <div className="mt-0.5 text-[11px] text-neutral-400">{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}
