"use client";

import { useState, useEffect } from "react";
import type { ClientRow, ClientStatus, Tier } from "../_lib/types";
import { statusTokens, tierTokens } from "../_lib/theme";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ClientFormValues {
  status: ClientStatus;
  tier: Tier | null;
  goalTacos: string;
  goalRevenue: string;
}

interface ClientEditPanelProps {
  client: ClientRow;
  isOpen: boolean;
  onClose: () => void;
  onSave: (values: ClientFormValues) => Promise<void>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_OPTIONS: ClientStatus[] = ["Active", "Onboarding", "Paused", "Churned"];
const TIER_OPTIONS: { value: Tier; label: string }[] = [
  { value: 1, label: "T1" },
  { value: 2, label: "T2" },
  { value: 3, label: "T3" },
];

function clientToForm(c: ClientRow): ClientFormValues {
  return {
    status: c.status,
    tier: c.tier,
    goalTacos: c.goalTacos != null ? String(c.goalTacos) : "",
    goalRevenue: c.goalRevenue != null ? String(c.goalRevenue) : "",
  };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusSelect({ value, onChange }: { value: ClientStatus; onChange: (v: ClientStatus) => void }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
        Status
      </label>
      <div className="flex flex-wrap gap-2">
        {STATUS_OPTIONS.map((s) => {
          const t = statusTokens[s];
          const active = value === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => onChange(s)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold transition-all ${
                active
                  ? `${t.bg} ${t.text} ring-2 ring-offset-1 ring-current`
                  : "bg-neutral-100 text-neutral-400 hover:bg-neutral-200"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${active ? t.dot : "bg-neutral-400"}`} />
              {t.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TierSelect({ value, onChange }: { value: Tier | null; onChange: (v: Tier | null) => void }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
        Tier
      </label>
      <div className="flex gap-2">
        {TIER_OPTIONS.map(({ value: tv, label }) => {
          const t = tierTokens[tv];
          const active = value === tv;
          return (
            <button
              key={tv}
              type="button"
              onClick={() => onChange(active ? null : tv)}
              className={`flex h-8 w-12 items-center justify-center rounded-md text-[11px] font-bold transition-all ${
                active
                  ? `${t.bg} ${t.text} ring-2 ring-offset-1 ring-neutral-400`
                  : "bg-neutral-100 text-neutral-400 hover:bg-neutral-200"
              }`}
            >
              {label}
            </button>
          );
        })}
        {value !== null && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="text-[11px] text-neutral-400 hover:text-neutral-600 px-1"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}

// ── Panel ─────────────────────────────────────────────────────────────────────

export function ClientEditPanel({ client, isOpen, onClose, onSave }: ClientEditPanelProps) {
  const [form, setForm] = useState<ClientFormValues>(() => clientToForm(client));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setForm(clientToForm(client));
      setError(null);
    }
  }, [isOpen, client]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    setError(null);

    const tacos = form.goalTacos !== "" ? parseFloat(form.goalTacos) : null;
    const revenue = form.goalRevenue !== "" ? parseFloat(form.goalRevenue) : null;
    if (tacos !== null && (isNaN(tacos) || tacos < 0)) {
      setError("Target TACoS must be a non-negative number.");
      return;
    }
    if (revenue !== null && (isNaN(revenue) || revenue < 0)) {
      setError("Goal Revenue must be a non-negative number.");
      return;
    }

    setSaving(true);
    try {
      await onSave(form);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]" onClick={onClose} aria-hidden="true" />

      <div className="fixed right-0 top-0 z-50 flex h-full w-90 flex-col bg-surface shadow-2xl border-l border-neutral-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-neutral-200 px-5 py-4">
          <div>
            <h2 className="text-[14px] font-bold text-ink">Edit Client</h2>
            <p className="text-[11px] text-neutral-400">{client.name}</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-ink transition-colors"
            aria-label="Close"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M1 1l10 10M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-y-auto">
          <div className="flex-1 space-y-6 px-5 py-5">
            <StatusSelect value={form.status} onChange={(v) => setForm((f) => ({ ...f, status: v }))} />
            <TierSelect value={form.tier} onChange={(v) => setForm((f) => ({ ...f, tier: v }))} />

            <div className="border-t border-neutral-100" />

            {/* Target TACoS */}
            <div className="space-y-1.5">
              <label htmlFor="goal-tacos" className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                Target TACoS
              </label>
              <div className="relative">
                <input
                  id="goal-tacos"
                  type="number"
                  min="0"
                  step="0.1"
                  value={form.goalTacos}
                  onChange={(e) => setForm((f) => ({ ...f, goalTacos: e.target.value }))}
                  placeholder="e.g. 15"
                  className="w-full rounded-lg border border-neutral-200 bg-white py-2.5 pl-3.5 pr-8 text-[13px] text-ink placeholder:text-neutral-400 outline-none focus:border-ink focus:ring-2 focus:ring-ink/10 transition-colors"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-neutral-400">%</span>
              </div>
              <p className="text-[11px] text-neutral-400">Used for the TACoS health indicator on the dashboard.</p>
            </div>

            {/* Goal Revenue */}
            <div className="space-y-1.5">
              <label htmlFor="goal-revenue" className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                Goal Revenue
              </label>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[12px] text-neutral-400">$</span>
                <input
                  id="goal-revenue"
                  type="number"
                  min="0"
                  step="1"
                  value={form.goalRevenue}
                  onChange={(e) => setForm((f) => ({ ...f, goalRevenue: e.target.value }))}
                  placeholder="e.g. 50000"
                  className="w-full rounded-lg border border-neutral-200 bg-white py-2.5 pl-7 pr-3.5 text-[13px] text-ink placeholder:text-neutral-400 outline-none focus:border-ink focus:ring-2 focus:ring-ink/10 transition-colors"
                />
              </div>
              <p className="text-[11px] text-neutral-400">Monthly revenue goal shown in the Revenue column.</p>
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-700">
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center gap-2 border-t border-neutral-200 px-5 py-4">
            <button
              type="submit"
              disabled={saving}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-[13px] font-semibold text-brand hover:bg-ink/90 disabled:opacity-60 transition-colors"
            >
              {saving ? "Saving…" : "Save Changes"}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-neutral-200 px-4 py-2.5 text-[13px] font-semibold text-neutral-600 hover:bg-neutral-50 transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
