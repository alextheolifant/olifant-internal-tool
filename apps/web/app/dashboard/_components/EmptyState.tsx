export function EmptyState() {
  return (
    <tr>
      <td colSpan={99} className="px-6 py-16 text-center">
        <div className="mx-auto flex max-w-xs flex-col items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100">
            <IconInbox className="h-6 w-6 text-neutral-400" />
          </div>
          <p className="text-[14px] font-semibold text-ink">No clients yet</p>
          <p className="text-[12px] text-neutral-500">
            Client accounts will appear here once their Amazon Ads profiles have
            been synced.
          </p>
          {/* TODO: link to client onboarding flow */}
        </div>
      </td>
    </tr>
  );
}

function IconInbox({ className }: { className?: string }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M22 12h-6l-2 3H10l-2-3H2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
