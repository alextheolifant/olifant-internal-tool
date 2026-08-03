"use client";

import { useState } from "react";
import type { SbObjective } from "../../_lib/ppc-config-api";

export function SbObjectivesInput({
  values,
  onChange,
}: {
  values: SbObjective[];
  onChange: (values: SbObjective[]) => void;
}) {
  const [campaignName, setCampaignName] = useState("");
  const [objective, setObjective] = useState<SbObjective["objective"]>("performance");

  function add() {
    const trimmed = campaignName.trim();
    if (!trimmed) return;
    onChange([...values, { campaignName: trimmed, objective }]);
    setCampaignName("");
  }

  function remove(index: number) {
    onChange(values.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {values.map((v, i) => (
          <span
            key={`${v.campaignName}-${i}`}
            className="inline-flex items-center gap-1.5 rounded-md bg-neutral-100 px-2 py-0.5 font-mono text-[11px] text-ink"
          >
            {v.campaignName} <span className="text-neutral-400">· {v.objective}</span>
            <button type="button" onClick={() => remove(i)} className="text-neutral-400 hover:text-red-600">
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-1.5">
        <input
          value={campaignName}
          onChange={(e) => setCampaignName(e.target.value)}
          placeholder="Campaign name"
          className="flex-1 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-[12.5px] text-ink placeholder:text-neutral-400 outline-none focus:border-ink focus:ring-2 focus:ring-ink/10"
        />
        <select
          value={objective}
          onChange={(e) => setObjective(e.target.value as SbObjective["objective"])}
          className="rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-[12.5px] text-ink outline-none focus:border-ink"
        >
          <option value="performance">performance</option>
          <option value="defense">defense</option>
          <option value="ntb">ntb</option>
        </select>
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
