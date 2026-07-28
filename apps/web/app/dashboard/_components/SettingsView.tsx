"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/context/auth-context";
import {
  connectAdsManagerAccount,
  getAdsManagerAccounts,
  type AdsManagerAccount,
} from "../_lib/ads-api";

const REASON_MESSAGES: Record<string, string> = {
  missing_params: "Amazon didn't return the expected authorization details. Please try connecting again.",
  connection_failed: "Couldn't connect the Ads Manager Account. The link may have expired — generate a new one and try again.",
  user_declined: "The Amazon consent screen was closed without authorizing.",
};

function ConnectionBanner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [status, setStatus] = useState<{ success: boolean; reason: string | null } | null>(() => {
    const adsConnected = searchParams.get("ads_connected");
    return adsConnected === null ? null : { success: adsConnected === "1", reason: searchParams.get("reason") };
  });

  useEffect(() => {
    if (searchParams.get("ads_connected") === null) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("ads_connected");
    url.searchParams.delete("reason");
    router.replace(url.pathname + url.search);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!status) return null;

  const message = status.success
    ? "Ads Manager Account connected successfully."
    : (status.reason && REASON_MESSAGES[status.reason]) || "Couldn't connect the Ads Manager Account. Please try again.";

  return (
    <div
      className={`mb-4 flex items-center justify-between gap-3 rounded-lg border px-4 py-2.5 text-[12px] ${
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

function AdsManagerAccountsSection() {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<AdsManagerAccount[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  useEffect(() => {
    getAdsManagerAccounts()
      .then(setAccounts)
      .catch((err) => setLoadError(err instanceof Error ? err.message : "Failed to load."));
  }, []);

  // Capped at one active connection per user for now (the org can still end
  // up with several — one per team member). Checked client-side for instant
  // feedback; the backend enforces the real constraint regardless.
  const alreadyConnectedByMe =
    !!user && (accounts?.some((a) => a.isActive && a.connectedByEmail === user.email) ?? false);

  async function handleConnect() {
    setConnecting(true);
    setConnectError(null);
    try {
      const { authorizationUrl } = await connectAdsManagerAccount();
      window.location.href = authorizationUrl;
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : "Failed to generate link.");
      setConnecting(false);
    }
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
      <h2 className="text-[14px] font-semibold text-ink">Ads Manager Accounts</h2>
      <p className="mt-1 text-[12px] text-neutral-500">
        Every connected Manager Account is shared across the whole team — anyone can see and use every account
        listed here, not just whoever connected it.
      </p>

      <div className="mt-4 space-y-2">
        {accounts === null && !loadError && (
          <p className="text-[12px] text-neutral-400">Loading…</p>
        )}
        {loadError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
            {loadError}
          </div>
        )}
        {accounts?.length === 0 && (
          <p className="text-[12px] text-neutral-400">No Ads Manager Accounts connected yet.</p>
        )}
        {accounts?.map((account) => (
          <div
            key={account.id}
            className="flex items-center justify-between rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2.5"
          >
            <div className="flex items-center gap-2">
              <span
                className={`h-1.5 w-1.5 rounded-full ${account.isActive ? "bg-green-400" : "bg-neutral-300"}`}
              />
              <span className="text-[12.5px] font-medium text-ink">
                {account.connectedByEmail ?? "Unknown"}
              </span>
            </div>
            <span className="text-[11px] text-neutral-400">
              Connected {new Date(account.connectedAt).toLocaleDateString()}
            </span>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={handleConnect}
        disabled={connecting || alreadyConnectedByMe}
        className="mt-4 w-full rounded-lg border border-neutral-200 px-4 py-2.5 text-[13px] font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-60 transition-colors"
      >
        {connecting ? "Generating…" : "Connect Ads Manager Account"}
      </button>

      {alreadyConnectedByMe && !connecting && (
        <p className="mt-2 text-[11px] text-neutral-400">
          You've already connected an Ads Manager Account. Each team member can connect one for now.
        </p>
      )}

      {connectError && (
        <div className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-700">
          {connectError}
        </div>
      )}

      <p className="mt-3 text-[11px] text-neutral-400">
        Opens Amazon's consent screen — sign in with the Amazon account whose Manager Account you want to connect.
        This adds a new connection without affecting any account already connected.
      </p>
    </div>
  );
}

export function SettingsView() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="text-xl font-semibold text-ink tracking-[-0.02em]">Settings</h1>
      <p className="mt-1 text-[13px] text-neutral-500">Integrations shared across your whole organization.</p>

      <div className="mt-6">
        <ConnectionBanner />
        <AdsManagerAccountsSection />
      </div>
    </div>
  );
}
