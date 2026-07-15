"use client";

import { useState } from "react";
import { connectClientAmazonAccount } from "../_lib/sp-api";

interface ConnectAmazonSectionProps {
  clientId: string;
}

export function ConnectAmazonSection({ clientId }: ConnectAmazonSectionProps) {
  const [loading, setLoading] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const { authorizationUrl } = await connectClientAmazonAccount(clientId);
      setUrl(authorizationUrl);
    } catch (err) {
      setUrl(null);
      setError(err instanceof Error ? err.message : "Failed to generate link.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-1.5">
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
        Amazon SP-API
      </label>

      {!url ? (
        <button
          type="button"
          onClick={handleGenerate}
          disabled={loading}
          className="w-full rounded-lg border border-neutral-200 px-4 py-2.5 text-[13px] font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-60 transition-colors"
        >
          {loading ? "Generating…" : "Generate Authorization Link"}
        </button>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              readOnly
              value={url}
              onFocus={(e) => e.target.select()}
              className="w-full min-w-0 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-[12px] text-neutral-600 outline-none"
            />
            <button
              type="button"
              onClick={handleCopy}
              className="shrink-0 rounded-lg border border-neutral-200 px-3 py-2 text-[12px] font-semibold text-neutral-600 hover:bg-neutral-50 transition-colors"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
          <button type="button" onClick={handleGenerate} className="text-[11px] text-neutral-400 hover:text-neutral-600">
            Generate a new link
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-700">{error}</div>
      )}

      <p className="text-[11px] text-neutral-400">
        Send this link to the client — they authorize with their own Seller Central login. Expires in 10 minutes.
      </p>
    </div>
  );
}
