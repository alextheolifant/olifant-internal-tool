"use client";

import { useState } from "react";

export function TagInput({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const trimmed = draft.trim();
    if (!trimmed || values.includes(trimmed)) return;
    onChange([...values, trimmed]);
    setDraft("");
  }

  function remove(value: string) {
    onChange(values.filter((v) => v !== value));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1.5 rounded-md bg-neutral-100 px-2 py-0.5 font-mono text-[11px] text-ink"
          >
            {v}
            <button
              type="button"
              onClick={() => remove(v)}
              className="text-neutral-400 hover:text-red-600"
              aria-label={`Remove ${v}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-1.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder ?? "Add and press Enter"}
          className="flex-1 rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-[12.5px] text-ink placeholder:text-neutral-400 outline-none focus:border-ink focus:ring-2 focus:ring-ink/10"
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
