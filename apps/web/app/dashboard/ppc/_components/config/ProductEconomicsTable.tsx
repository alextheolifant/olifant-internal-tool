"use client";

import { useState } from "react";
import { healthTokens, strategyTokens } from "../../../_lib/theme";
import {
  createProductEconomics,
  deleteProductEconomics,
  updateProductEconomics,
  type ProductEconomicsInput,
  type ProductEconomicsRow,
  type PpcStrategy,
} from "../../_lib/ppc-config-api";
import { CompletenessMeter } from "./CompletenessMeter";

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

// Green when the working target is under BE (profitable); amber on Launch
// rows, where running above BE is intentional, not an error.
function acosColorClass(product: ProductEconomicsRow): string {
  if (product.strategy === "launch") return healthTokens.watch.text;
  const { value } = product.resolvedTargetAcos;
  if (value !== null && product.margin !== null && value < product.margin) return healthTokens.on_target.text;
  return "text-ink";
}

function strategyBadgeClass(strategy: PpcStrategy | null): string {
  if (strategy === null) return `${healthTokens.watch.bg} ${healthTokens.watch.text}`;
  const t = strategyTokens[strategy];
  return `${t.bg} ${t.text}`;
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

  async function commit(patch: Partial<Omit<ProductEconomicsInput, "asin">>) {
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
  const acosColor = acosColorClass(product);
  const { value: resolvedAcos, isFallback: acosIsFallback } = product.resolvedTargetAcos;

  return (
    <div
      className={`grid grid-cols-[1.5fr_75px_65px_150px_130px_130px_32px] items-start gap-2 border-b border-neutral-100 px-3 py-2.5 text-[12px] ${
        configured ? "" : "bg-amber-50/50"
      } ${saving ? "opacity-60" : ""}`}
    >
      <div className="min-w-0">
        <div
          className={`truncate ${product.productName ? "text-ink" : "text-neutral-300"}`}
          title="Populated by the SP-API listings sync — not editable here"
        >
          {product.productName ?? "not yet synced"}
        </div>
        <div className="mt-0.5 truncate font-mono text-[10px] text-neutral-400">{product.asin}</div>
      </div>

      <input
        type="number"
        step="0.1"
        defaultValue={product.margin ?? ""}
        onBlur={(e) => commit({ margin: numOrNull(e.target.value) })}
        placeholder="—"
        className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-right outline-none hover:border-neutral-200 focus:border-ink focus:bg-white"
      />

      <span className="block pt-1 text-right font-mono text-[11.5px] text-neutral-400" title="Break-even ACOS = margin">
        {product.margin !== null ? `${product.margin}%` : "—"}
      </span>

      <div>
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
          className={`w-full rounded-md border border-transparent px-1.5 py-1 text-[11px] font-semibold outline-none hover:border-neutral-200 focus:border-ink focus:bg-white ${strategyBadgeClass(product.strategy)}`}
        >
          <option value="">Needs economics</option>
          {STRATEGIES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        {!configured && product.strategy !== null && (
          <span
            className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[9.5px] font-semibold ${healthTokens.watch.bg} ${healthTokens.watch.text}`}
          >
            Needs economics
          </span>
        )}

        {product.strategy === "launch" && (
          <input
            type="date"
            defaultValue={product.launchUntil ?? ""}
            onChange={(e) => commit({ launchUntil: e.target.value || null })}
            title="Required while strategy is launch — auto-flips to growth after"
            className={`mt-1 w-full rounded-md border bg-transparent px-1 py-0.5 text-[10.5px] outline-none hover:border-neutral-200 focus:border-ink focus:bg-white ${
              product.launchUntil === null ? "border-red-300" : "border-transparent"
            }`}
          />
        )}
      </div>

      <div>
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
          className={`w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-right font-mono text-[12.5px] font-bold outline-none hover:border-neutral-200 focus:border-ink focus:bg-white ${acosColor}`}
        />
        {acosIsFallback && resolvedAcos !== null && (
          <div className={`mt-0.5 text-right text-[10px] italic ${acosColor === "text-ink" ? "text-neutral-400" : acosColor}`}>
            {resolvedAcos}% (default)
          </div>
        )}
      </div>

      <input
        type="number"
        step="0.1"
        defaultValue={product.targetTacos ?? ""}
        onBlur={(e) => commit({ targetTacos: numOrNull(e.target.value) })}
        placeholder="— none"
        className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-1 text-right font-mono text-[12px] text-ink outline-none placeholder:text-neutral-400 hover:border-neutral-200 focus:border-ink focus:bg-white"
      />

      <button
        type="button"
        onClick={handleDelete}
        className="justify-self-center pt-1 text-neutral-300 hover:text-red-600"
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
  completeness,
  onChange,
}: {
  clientId: string;
  products: ProductEconomicsRow[];
  completeness: { percent: number; checklist: { key: string; label: string; met: boolean }[] };
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

  const cols = "1.5fr 75px 65px 150px 130px 130px 32px";
  const unconfiguredCount = products.filter((p) => !isConfigured(p)).length;
  const metCount = completeness.checklist.filter((c) => c.met).length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[13px] font-medium text-ink">Product economics</div>
          <div className="mt-0.5 text-[11px] text-neutral-400">
            {products.length} product{products.length === 1 ? "" : "s"} from catalog
            {unconfiguredCount > 0 && ` · ${unconfiguredCount} need${unconfiguredCount === 1 ? "s" : ""} economics`}
          </div>
        </div>
        <CompletenessMeter
          percent={completeness.percent}
          metCount={metCount}
          total={completeness.checklist.length}
          barClassName="w-28"
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-neutral-200">
        <div className="min-w-195">
          <div
            className="grid items-center gap-2 border-b border-neutral-200 bg-neutral-100 px-3 py-2 text-[10.5px] font-semibold uppercase tracking-wide text-neutral-500"
            style={{ gridTemplateColumns: cols }}
          >
            <span>Product</span>
            <span className="text-right">Margin</span>
            <span className="text-right">BE</span>
            <span>Strategy</span>
            <span className="text-right">Target ACOS</span>
            <span className="text-right">Target TACOS</span>
            <span />
          </div>

          {products.length === 0 && (
            <div className="px-3 py-6 text-center text-[12px] text-neutral-400">
              No active products yet — add an ASIN below to get started. Product names sync automatically once
              SP-API listings are pulled.
            </div>
          )}

          {products.map((p) => (
            <ProductRow key={p.id} product={p} onSaved={updateRow} onDeleted={removeRow} />
          ))}

          <div className="flex items-center gap-2 px-3 py-2.5">
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

      <p className="text-[10.5px] text-neutral-400">
        Product name and ASIN are read-only, synced from the catalog. Rows without their own target fall back to
        the account default shown above (marked "(default)") — task evidence states when a default was used.
        Inactive/discontinued products are hidden here but their economics stay saved.
      </p>
    </div>
  );
}
