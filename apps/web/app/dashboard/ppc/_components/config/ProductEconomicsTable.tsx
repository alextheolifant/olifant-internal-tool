"use client";

import { useState } from "react";
import {
  createProductEconomics,
  deleteProductEconomics,
  updateProductEconomics,
  type ProductEconomicsRow,
  type PpcStrategy,
} from "../../_lib/ppc-config-api";

const STRATEGIES: PpcStrategy[] = ["launch", "growth", "maintain"];

// Target ACOS default per strategy, as a multiple of BE (break-even ACOS,
// i.e. margin): launch tolerates spend above break-even, maintain defends it.
const STRATEGY_BE_MULTIPLIER: Record<PpcStrategy, number> = {
  launch: 1.2,
  growth: 1.0,
  maintain: 0.75,
};

function isConfigured(p: ProductEconomicsRow): boolean {
  const hasTarget = p.strategy !== null && (p.targetAcos !== null || p.targetTacos !== null);
  const launchDated = p.strategy !== "launch" || p.launchUntil !== null;
  return hasTarget && launchDated;
}

function numOrNull(v: string): number | null {
  if (v.trim() === "") return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

interface RowProps {
  product: ProductEconomicsRow;
  onSaved: (updated: ProductEconomicsRow) => void;
  onDeleted: (id: string) => void;
}

function ProductRow({ product, onSaved, onDeleted }: RowProps) {
  const [saving, setSaving] = useState(false);

  async function commit(patch: Partial<Omit<ProductEconomicsRow, "id" | "asin">>) {
    setSaving(true);
    try {
      const updated = await updateProductEconomics(product.id, patch);
      onSaved(updated);
    } catch {
      // Keep the previous row values on failure — nothing to roll back since
      // we only patch after the request resolves.
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Remove ${product.asin} from the roster?`)) return;
    try {
      await deleteProductEconomics(product.id);
      onDeleted(product.id);
    } catch {
      // no-op — row stays if the delete failed
    }
  }

  const configured = isConfigured(product);

  return (
    <div
      className={`grid grid-cols-[110px_1.4fr_70px_60px_110px_90px_90px_120px_32px] items-center gap-2 border-b border-neutral-100 px-3 py-2 text-[12px] ${
        configured ? "" : "bg-amber-50/50"
      } ${saving ? "opacity-60" : ""}`}
    >
      <span className="truncate font-mono text-[11px] text-neutral-500">{product.asin}</span>
      <input
        defaultValue={product.productName ?? ""}
        onBlur={(e) => commit({ productName: e.target.value || null })}
        placeholder="Product name"
        className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 outline-none hover:border-neutral-200 focus:border-ink focus:bg-white"
      />
      <input
        type="number"
        step="0.1"
        defaultValue={product.margin ?? ""}
        onBlur={(e) => commit({ margin: numOrNull(e.target.value) })}
        placeholder="—"
        className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-right outline-none hover:border-neutral-200 focus:border-ink focus:bg-white"
      />
      <span className="text-right font-mono text-[11.5px] text-neutral-400" title="Break-even ACOS = margin">
        {product.margin !== null ? `${product.margin}%` : "—"}
      </span>
      <select
        defaultValue={product.strategy ?? ""}
        onChange={(e) => {
          const strategy = (e.target.value || null) as PpcStrategy | null;
          // Suggest target ACOS = BE (margin) × the strategy's multiplier when
          // no explicit target is set yet — still click-to-edit afterward.
          if (strategy && product.targetAcos === null && product.margin !== null) {
            const suggested = Math.round(product.margin * STRATEGY_BE_MULTIPLIER[strategy] * 10) / 10;
            commit({ strategy, targetAcos: suggested });
          } else {
            commit({ strategy });
          }
        }}
        className="w-full rounded-md border border-transparent bg-transparent px-1 py-1 outline-none hover:border-neutral-200 focus:border-ink focus:bg-white"
      >
        <option value="">—</option>
        {STRATEGIES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <input
        // Remount when targetAcos changes from outside this field (the
        // strategy select can derive and commit a value here) — defaultValue
        // only applies on mount, so an external change needs a fresh input.
        key={product.targetAcos ?? "empty"}
        type="number"
        step="0.1"
        defaultValue={product.targetAcos ?? ""}
        onBlur={(e) => commit({ targetAcos: numOrNull(e.target.value) })}
        placeholder="—"
        title="Explicit, or derived from strategy: launch = BE×1.2, growth = BE×1.0, maintain = BE×0.75"
        className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-right outline-none hover:border-neutral-200 focus:border-ink focus:bg-white"
      />
      <input
        type="number"
        step="0.1"
        defaultValue={product.targetTacos ?? ""}
        onBlur={(e) => commit({ targetTacos: numOrNull(e.target.value) })}
        placeholder="—"
        className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-right outline-none hover:border-neutral-200 focus:border-ink focus:bg-white"
      />
      <input
        type="date"
        defaultValue={product.launchUntil ?? ""}
        onChange={(e) => commit({ launchUntil: e.target.value || null })}
        title={product.strategy === "launch" ? "Required while strategy is launch — auto-flips to growth after" : undefined}
        className={`w-full rounded-md border bg-transparent px-1 py-1 text-[11px] outline-none hover:border-neutral-200 focus:border-ink focus:bg-white ${
          product.strategy === "launch" && product.launchUntil === null ? "border-red-300" : "border-transparent"
        }`}
      />
      <button
        type="button"
        onClick={handleDelete}
        className="justify-self-center text-neutral-300 hover:text-red-600"
        aria-label={`Remove ${product.asin}`}
      >
        ×
      </button>
    </div>
  );
}

export function ProductEconomicsTable({
  clientId,
  products,
  onChange,
}: {
  clientId: string;
  products: ProductEconomicsRow[];
  onChange: (products: ProductEconomicsRow[]) => void;
}) {
  const [newAsin, setNewAsin] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  async function addRow() {
    const asin = newAsin.trim();
    if (!asin) return;
    setAdding(true);
    setAddError(null);
    try {
      const created = await createProductEconomics(clientId, { asin });
      onChange([...products, created]);
      setNewAsin("");
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to add ASIN");
    } finally {
      setAdding(false);
    }
  }

  function updateRow(updated: ProductEconomicsRow) {
    onChange(products.map((p) => (p.id === updated.id ? updated : p)));
  }

  function removeRow(id: string) {
    onChange(products.filter((p) => p.id !== id));
  }

  const cols = "110px 1.4fr 70px 60px 110px 90px 90px 120px 32px";

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-neutral-200">
        <div className="min-w-[760px]">
          <div
            className="grid items-center gap-2 border-b border-neutral-200 bg-neutral-100 px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-500"
            style={{ gridTemplateColumns: cols }}
          >
            <span>ASIN</span>
            <span>Product</span>
            <span className="text-right">Margin %</span>
            <span className="text-right">BE</span>
            <span>Strategy</span>
            <span className="text-right">Target ACOS</span>
            <span className="text-right">Target TACOS</span>
            <span>Launch until</span>
            <span />
          </div>

          {products.length === 0 && (
            <div className="px-3 py-6 text-center text-[12px] text-neutral-400">
              No products yet — add an ASIN below to get started.
            </div>
          )}

          {products.map((p) => (
            <ProductRow key={p.id} product={p} onSaved={updateRow} onDeleted={removeRow} />
          ))}

          <div className="flex items-center gap-2 px-3 py-2.5" style={{ gridTemplateColumns: cols }}>
            <input
              value={newAsin}
              onChange={(e) => setNewAsin(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addRow()}
              placeholder="Add ASIN…"
              disabled={adding}
              className="w-40 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-[12px] outline-none focus:border-ink focus:ring-2 focus:ring-ink/10"
            />
            <button
              type="button"
              onClick={addRow}
              disabled={adding || !newAsin.trim()}
              className="rounded-lg border border-neutral-200 px-3 py-1.5 text-[12px] font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
            >
              {adding ? "Adding…" : "Add"}
            </button>
            {addError && <span className="text-[11.5px] text-red-600">{addError}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
