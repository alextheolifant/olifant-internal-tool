"use client";

import { useState } from "react";
import type { HarvestDestination } from "../../_lib/ppc-config-api";

export function HarvestDestinationsInput({
  values,
  onChange,
}: {
  values: HarvestDestination[];
  onChange: (values: HarvestDestination[]) => void;
}) {
  const [asin, setAsin] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [maxTargets, setMaxTargets] = useState("");

  function add() {
    if (!asin.trim() || !campaignName.trim()) return;
    const parsedMax = maxTargets.trim() !== "" ? parseInt(maxTargets, 10) : null;
    onChange([
      ...values,
      { asin: asin.trim(), campaignName: campaignName.trim(), maxTargets: parsedMax },
    ]);
    setAsin("");
    setCampaignName("");
    setMaxTargets("");
  }

  function remove(index: number) {
    onChange(values.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {values.map((v, i) => (
          <span
            key={`${v.asin}-${i}`}
            className="inline-flex items-center gap-1.5 rounded-md bg-neutral-100 px-2 py-0.5 font-mono text-[11px] text-ink"
          >
            {v.asin} <span className="text-neutral-400">→</span> {v.campaignName}
            {v.maxTargets !== null && <span className="text-neutral-400">· max {v.maxTargets}</span>}
            <button type="button" onClick={() => remove(i)} className="text-neutral-400 hover:text-red-600">
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-1.5">
        <input
          value={asin}
          onChange={(e) => setAsin(e.target.value)}
          placeholder="ASIN"
          className="w-32 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-[12.5px] text-ink placeholder:text-neutral-400 outline-none focus:border-ink focus:ring-2 focus:ring-ink/10"
        />
        <input
          value={campaignName}
          onChange={(e) => setCampaignName(e.target.value)}
          placeholder="Destination campaign"
          className="flex-1 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-[12.5px] text-ink placeholder:text-neutral-400 outline-none focus:border-ink focus:ring-2 focus:ring-ink/10"
        />
        <input
          value={maxTargets}
          onChange={(e) => setMaxTargets(e.target.value)}
          type="number"
          min="1"
          placeholder="Max targets"
          className="w-28 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-[12.5px] text-ink placeholder:text-neutral-400 outline-none focus:border-ink focus:ring-2 focus:ring-ink/10"
        />
        <button
          type="button"
          onClick={add}
          className="rounded-lg border border-neutral-200 px-3 py-1.5 text-[12px] font-semibold text-neutral-600 hover:bg-neutral-50"
        >
          Add
        </button>
      </div>
    </div>
  );
}
