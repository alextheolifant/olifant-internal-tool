"use client";

import { useState } from "react";

export function ThresholdOverridesInput({
  values,
  onChange,
}: {
  values: Record<string, number>;
  onChange: (values: Record<string, number>) => void;
}) {
  const [open, setOpen] = useState(Object.keys(values).length > 0);
  const [ruleName, setRuleName] = useState("");
  const [overrideValue, setOverrideValue] = useState("");

  function add() {
    const key = ruleName.trim();
    const value = parseFloat(overrideValue);
    if (!key || isNaN(value)) return;
    onChange({ ...values, [key]: value });
    setRuleName("");
    setOverrideValue("");
  }

  function remove(key: string) {
    const next = { ...values };
    delete next[key];
    onChange(next);
  }

  const entries = Object.entries(values);

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-[12px] font-medium text-neutral-500 hover:text-ink"
      >
        <span className={`transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
        {open ? "Hide" : "Show"} overrides {entries.length > 0 && `(${entries.length})`}
      </button>

      {open && (
        <div className="space-y-2 rounded-lg border border-neutral-200 p-3">
          {entries.map(([key, value]) => (
            <div key={key} className="flex items-center gap-2">
              <span className="flex-1 rounded-md bg-neutral-100 px-2.5 py-1 font-mono text-[11.5px] text-ink">{key}</span>
              <span className="w-20 rounded-md bg-neutral-100 px-2.5 py-1 text-right font-mono text-[11.5px] text-ink">
                {value}
              </span>
              <button type="button" onClick={() => remove(key)} className="text-neutral-400 hover:text-red-600">
                ×
              </button>
            </div>
          ))}
          <div className="flex gap-1.5">
            <input
              value={ruleName}
              onChange={(e) => setRuleName(e.target.value)}
              placeholder="Rule name (e.g. W2)"
              className="flex-1 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-[12.5px] text-ink placeholder:text-neutral-400 outline-none focus:border-ink focus:ring-2 focus:ring-ink/10"
            />
            <input
              value={overrideValue}
              onChange={(e) => setOverrideValue(e.target.value)}
              type="number"
              step="any"
              placeholder="Value"
              className="w-24 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-[12.5px] text-ink placeholder:text-neutral-400 outline-none focus:border-ink focus:ring-2 focus:ring-ink/10"
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
      )}
    </div>
  );
}
