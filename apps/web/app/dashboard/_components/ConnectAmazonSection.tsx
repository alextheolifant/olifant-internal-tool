"use client";

import { useState } from "react";
import {
  connectClientAmazonAccount,
  RegionAmbiguousError,
  SP_API_REGIONS,
  SP_API_REGION_LABELS,
  type ConnectAmazonResponse,
} from "../_lib/sp-api";

interface ConnectAmazonSectionProps {
  clientId: string;
}

export function ConnectAmazonSection({ clientId }: ConnectAmazonSectionProps) {
  const [loading, setLoading] = useState(false);
  const [links, setLinks] = useState<ConnectAmazonResponse[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copiedRegion, setCopiedRegion] = useState<string | null>(null);
  const [showRegionPicker, setShowRegionPicker] = useState(false);

  const remainingRegions = SP_API_REGIONS.filter(
    (r) => !links.some((l) => l.region === r.value),
  );

  async function handleGenerate(regionOverride?: string) {
    setLoading(true);
    setError(null);
    setCopiedRegion(null);
    try {
      const result = await connectClientAmazonAccount(clientId, { region: regionOverride });
      setLinks((prev) => [...prev.filter((l) => l.region !== result.region), result]);
      setShowRegionPicker(false);
    } catch (err) {
      if (err instanceof RegionAmbiguousError) {
        setShowRegionPicker(true);
      } else {
        setError(err instanceof Error ? err.message : "Failed to generate link.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy(link: ConnectAmazonResponse) {
    await navigator.clipboard.writeText(link.authorizationUrl);
    setCopiedRegion(link.region);
    setTimeout(() => setCopiedRegion(null), 2000);
  }

  return (
    <div className="space-y-1.5">
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
        Amazon SP-API
      </label>

      {links.length > 0 && (
        <div className="space-y-2">
          {links.map((link) => (
            <div key={link.region} className="space-y-1">
              <span className="inline-block rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                {SP_API_REGION_LABELS[link.region] ?? link.region}
              </span>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={link.authorizationUrl}
                  onFocus={(e) => e.target.select()}
                  className="w-full min-w-0 rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-[12px] text-neutral-600 outline-none"
                />
                <button
                  type="button"
                  onClick={() => handleCopy(link)}
                  className="shrink-0 rounded-lg border border-neutral-200 px-3 py-2 text-[12px] font-semibold text-neutral-600 hover:bg-neutral-50 transition-colors"
                >
                  {copiedRegion === link.region ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showRegionPicker ? (
        <div className="space-y-1.5 rounded-lg border border-neutral-200 p-3">
          <p className="text-[11px] text-neutral-500">
            {links.length > 0
              ? "Which region is this link for?"
              : "This client operates in multiple regions — pick one to generate a link for."}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {remainingRegions.map((r) => (
              <button
                key={r.value}
                type="button"
                onClick={() => handleGenerate(r.value)}
                disabled={loading}
                className="rounded-lg border border-neutral-200 px-3 py-1.5 text-[12px] font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-60 transition-colors"
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => handleGenerate()}
          disabled={loading}
          className="w-full rounded-lg border border-neutral-200 px-4 py-2.5 text-[13px] font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-60 transition-colors"
        >
          {loading
            ? "Generating…"
            : links.length > 0
              ? "Generate a new link"
              : "Generate Authorization Link"}
        </button>
      )}

      {links.length > 0 && !showRegionPicker && remainingRegions.length > 0 && (
        <button
          type="button"
          onClick={() => setShowRegionPicker(true)}
          className="text-[11px] text-neutral-400 hover:text-neutral-600"
        >
          Add a link for another region
        </button>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-700">{error}</div>
      )}

      <p className="text-[11px] text-neutral-400">
        Send this link to the client — they authorize with their own Seller Central login. One authorization covers
        every marketplace within that region. Expires in 10 minutes.
      </p>
    </div>
  );
}
