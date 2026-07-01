"use client";

interface ErrorStateProps {
  message: string;
  onRetry: () => void;
}

export function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <tr>
      <td colSpan={99} className="px-6 py-16 text-center">
        <div className="mx-auto flex max-w-sm flex-col items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
            <IconAlert className="h-6 w-6 text-red-600" />
          </div>
          <div>
            <p className="text-[14px] font-semibold text-ink">Failed to load clients</p>
            <p className="mt-1 text-[12px] text-neutral-500">{message}</p>
          </div>
          <button
            onClick={onRetry}
            className="rounded-lg bg-ink px-4 py-2 text-[12px] font-semibold text-neutral-50 transition-colors hover:bg-neutral-800"
          >
            Retry
          </button>
        </div>
      </td>
    </tr>
  );
}

function IconAlert({ className }: { className?: string }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 8v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="12" cy="16" r="0.75" fill="currentColor" />
    </svg>
  );
}
