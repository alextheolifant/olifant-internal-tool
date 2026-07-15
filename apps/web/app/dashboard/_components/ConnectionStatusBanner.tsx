"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const REASON_MESSAGES: Record<string, string> = {
  missing_params: "Amazon didn't return the expected authorization details. Please try connecting again.",
  connection_failed: "Couldn't connect the Amazon account. The link may have expired — generate a new one and try again.",
};

export function ConnectionStatusBanner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Snapshot once on first read — searchParams itself changes (to null) once
  // the effect below strips the URL, but the banner should stay visible until
  // the user dismisses it.
  const [status, setStatus] = useState<{ success: boolean; reason: string | null } | null>(() => {
    const spConnected = searchParams.get("sp_connected");
    return spConnected === null ? null : { success: spConnected === "1", reason: searchParams.get("reason") };
  });

  useEffect(() => {
    if (searchParams.get("sp_connected") === null) return;
    // Strip the OAuth callback params from the URL once read, so a refresh
    // doesn't keep re-showing the banner.
    const url = new URL(window.location.href);
    url.searchParams.delete("sp_connected");
    url.searchParams.delete("clientId");
    url.searchParams.delete("reason");
    router.replace(url.pathname + url.search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!status) return null;

  const message = status.success
    ? "Amazon account connected successfully."
    : (status.reason && REASON_MESSAGES[status.reason]) || "Couldn't connect the Amazon account. Please try again.";

  return (
    <div
      className={`flex items-center justify-between gap-3 border-b px-5 py-2.5 text-[12px] ${
        status.success ? "border-green-200 bg-green-50 text-green-700" : "border-red-200 bg-red-50 text-red-700"
      }`}
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={() => setStatus(null)}
        className="shrink-0 text-current opacity-60 hover:opacity-100"
        aria-label="Dismiss"
      >
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
