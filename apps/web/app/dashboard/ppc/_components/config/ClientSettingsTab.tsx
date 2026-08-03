"use client";

import { useEffect, useState } from "react";
import {
  fetchPpcConfig,
  updatePpcConfig,
  type HarvestDestination,
  type PpcConfig,
  type SbObjective,
} from "../../_lib/ppc-config-api";
import { CfgRow } from "./CfgRow";
import { CompletenessMeter } from "./CompletenessMeter";
import { HarvestDestinationsInput } from "./HarvestDestinationsInput";
import { ProductEconomicsTable } from "./ProductEconomicsTable";
import { SbObjectivesInput } from "./SbObjectivesInput";
import { TagInput } from "./TagInput";
import { ThresholdOverridesInput } from "./ThresholdOverridesInput";

const inputCls =
  "rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-[13px] text-ink placeholder:text-neutral-400 outline-none focus:border-ink focus:ring-2 focus:ring-ink/10 transition-colors";

function ToggleField({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex items-center gap-2.5">
      <span className={`relative h-5.5 w-9.5 shrink-0 rounded-full transition-colors ${checked ? "bg-green-500" : "bg-neutral-300"}`}>
        <span className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow transition-all ${checked ? "left-4.5" : "left-0.5"}`} />
      </span>
      <span className="text-[12.5px] text-neutral-500">{checked ? "on" : "off"}</span>
    </button>
  );
}

export function ClientSettingsTab({ clientId }: { clientId: string }) {
  const [config, setConfig] = useState<PpcConfig | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [opsStatus, setOpsStatus] = useState<"active" | "frozen">("active");
  const [accountTargetMetric, setAccountTargetMetric] = useState<"acos" | "tacos">("tacos");
  const [accountTargetMetricValue, setAccountTargetMetricValue] = useState("");
  const [monthlyAdBudget, setMonthlyAdBudget] = useState("");
  const [marginDefault, setMarginDefault] = useState("");
  const [targetAcosDefault, setTargetAcosDefault] = useState("");
  const [conservativeMode, setConservativeMode] = useState(false);
  const [standingDirectives, setStandingDirectives] = useState("");
  const [brandTerms, setBrandTerms] = useState<string[]>([]);
  const [ownAsins, setOwnAsins] = useState<string[]>([]);
  const [sbObjectives, setSbObjectives] = useState<SbObjective[]>([]);
  const [harvestDestinations, setHarvestDestinations] = useState<HarvestDestination[]>([]);
  const [thresholdOverrides, setThresholdOverrides] = useState<Record<string, number>>({});

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);
    fetchPpcConfig(clientId, controller.signal)
      .then((c) => {
        setConfig(c);
        setOpsStatus(c.opsStatus);
        setAccountTargetMetric(c.accountTargetMetric);
        setAccountTargetMetricValue(c.accountTargetMetricValue != null ? String(c.accountTargetMetricValue) : "");
        setMonthlyAdBudget(c.monthlyAdBudget != null ? String(c.monthlyAdBudget) : "");
        setMarginDefault(c.marginDefault != null ? String(c.marginDefault) : "");
        setTargetAcosDefault(c.targetAcosDefault != null ? String(c.targetAcosDefault) : "");
        setConservativeMode(c.conservativeMode);
        setStandingDirectives(c.standingDirectives ?? "");
        setBrandTerms(c.brandTerms);
        setOwnAsins(c.ownAsins);
        setSbObjectives(c.sbObjectives);
        setHarvestDestinations(c.harvestDestinationCampaigns);
        setThresholdOverrides(c.thresholdOverrides);
      })
      .catch((e) => {
        if (e instanceof Error && e.name === "AbortError") return;
        setLoadError(e instanceof Error ? e.message : "Failed to load configuration");
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [clientId]);

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const updated = await updatePpcConfig(clientId, {
        opsStatus,
        monthlyAdBudget: monthlyAdBudget !== "" ? parseFloat(monthlyAdBudget) : null,
        marginDefault: marginDefault !== "" ? parseFloat(marginDefault) : null,
        targetAcosDefault: targetAcosDefault !== "" ? parseFloat(targetAcosDefault) : null,
        accountTargetMetric,
        accountTargetMetricValue: accountTargetMetricValue !== "" ? parseFloat(accountTargetMetricValue) : null,
        conservativeMode,
        standingDirectives: standingDirectives || null,
        brandTerms,
        ownAsins,
        sbObjectives,
        harvestDestinationCampaigns: harvestDestinations,
        thresholdOverrides,
      });
      setConfig(updated);
      setSaved(true);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  // Product-row edits save themselves immediately (ProductEconomicsTable calls
  // the API directly) and only report the new products array back — refetch
  // completeness separately so the meter reflects those saves right away
  // instead of waiting for the next full "Save configuration" click.
  async function refreshCompleteness() {
    try {
      const fresh = await fetchPpcConfig(clientId);
      setConfig((prev) => (prev ? { ...prev, completeness: fresh.completeness } : prev));
    } catch {
      // non-fatal — the meter just stays stale until the next save/reload
    }
  }

  if (isLoading) {
    return <div className="px-1 py-10 text-center text-[13px] text-neutral-400">Loading configuration…</div>;
  }
  if (loadError || !config) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-8 text-center text-[13px] text-red-700">
        Failed to load configuration{loadError ? ` — ${loadError}` : ""}.
      </div>
    );
  }

  const { percent, checklist } = config.completeness;
  const metCount = checklist.filter((c) => c.met).length;

  return (
    <div className="rounded-xl border border-neutral-200 bg-surface p-4">
      <div className="mb-3.5">
        <CompletenessMeter percent={percent} metCount={metCount} total={checklist.length} />
      </div>
      {percent < 100 && (
        <ul className="mb-3.5 space-y-0.5">
          {checklist
            .filter((c) => !c.met)
            .map((c) => (
              <li key={c.key} className="text-[11px] text-neutral-400">
                · {c.label}
              </li>
            ))}
        </ul>
      )}

      <CfgRow label="Profiles / marketplaces" hint="Ads API profile ids">
        <div className="flex flex-wrap gap-1.5">
          {config.adsAccounts.length === 0 ? (
            <span className="text-[12.5px] text-neutral-400">No Ads API profiles connected yet.</span>
          ) : (
            config.adsAccounts.map((a) => (
              <span
                key={a.profileId}
                className="inline-flex items-center gap-1.5 rounded-md bg-neutral-100 px-2 py-0.5 font-mono text-[11px] text-ink"
              >
                {a.marketplace ?? "—"} · {a.profileId}
              </span>
            ))
          )}
        </div>
      </CfgRow>

      <CfgRow label="Status" hint="Frozen = exceptions only, no optimization tasks.">
        <select
          value={opsStatus}
          onChange={(e) => setOpsStatus(e.target.value as "active" | "frozen")}
          className={`${inputCls} w-44`}
        >
          <option value="active">Active</option>
          <option value="frozen">Frozen</option>
        </select>
      </CfgRow>

      <CfgRow
        label="Account target metric"
        hint="Rollups and reporting — bid math uses per-product targets below."
      >
        <div className="flex items-center gap-2">
          <select
            value={accountTargetMetric}
            onChange={(e) => setAccountTargetMetric(e.target.value as "acos" | "tacos")}
            className={`${inputCls} w-28`}
          >
            <option value="acos">ACOS</option>
            <option value="tacos">TACOS</option>
          </select>
          <div className="relative w-24">
            <input
              type="number"
              min="0"
              step="0.1"
              value={accountTargetMetricValue}
              onChange={(e) => setAccountTargetMetricValue(e.target.value)}
              placeholder="e.g. 25"
              className={`${inputCls} w-full pr-6`}
            />
            <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-neutral-400">%</span>
          </div>
        </div>
      </CfgRow>

      <CfgRow label="Monthly ad budget">
        <div className="relative w-40">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[12px] text-neutral-400">$</span>
          <input
            type="number"
            min="0"
            value={monthlyAdBudget}
            onChange={(e) => setMonthlyAdBudget(e.target.value)}
            placeholder="e.g. 5000"
            className={`${inputCls} w-full pl-6`}
          />
        </div>
      </CfgRow>

      <CfgRow
        label="Account default economics"
        hint={'Fallback when a product has no row — tasks state "account default" in evidence.'}
      >
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5">
            <span className="text-[11px] text-neutral-400">BE</span>
            <div className="relative w-24">
              <input
                type="number"
                min="0"
                step="0.1"
                value={marginDefault}
                onChange={(e) => setMarginDefault(e.target.value)}
                placeholder="e.g. 35"
                className={`${inputCls} w-full pr-6`}
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-neutral-400">%</span>
            </div>
          </label>
          <label className="flex items-center gap-1.5">
            <span className="text-[11px] text-neutral-400">Target</span>
            <div className="relative w-24">
              <input
                type="number"
                min="0"
                step="0.1"
                value={targetAcosDefault}
                onChange={(e) => setTargetAcosDefault(e.target.value)}
                placeholder="e.g. 30"
                className={`${inputCls} w-full pr-6`}
              />
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[12px] text-neutral-400">%</span>
            </div>
          </label>
        </div>
      </CfgRow>

      <CfgRow label="Conservative mode">
        <ToggleField checked={conservativeMode} onChange={setConservativeMode} />
      </CfgRow>

      <div className="border-b border-neutral-100 py-3">
        <ProductEconomicsTable
          clientId={clientId}
          products={config.products}
          completeness={config.completeness}
          onChange={(products) => {
            setConfig({ ...config, products });
            refreshCompleteness();
          }}
        />
      </div>

      <CfgRow label="Brand terms">
        <TagInput values={brandTerms} onChange={setBrandTerms} placeholder="e.g. coat defense" />
      </CfgRow>

      <CfgRow label="Own ASINs">
        <TagInput values={ownAsins} onChange={setOwnAsins} placeholder="e.g. B0D4K1234" />
      </CfgRow>

      <CfgRow label="SB campaign objectives" hint="Defense / NTB campaigns are exempt from ACOS-based bid-down and pause tasks.">
        <SbObjectivesInput values={sbObjectives} onChange={setSbObjectives} />
      </CfgRow>

      <CfgRow label="Designated harvest campaigns" hint="Which campaign receives harvested keywords for a given ASIN.">
        <HarvestDestinationsInput values={harvestDestinations} onChange={setHarvestDestinations} />
      </CfgRow>

      <CfgRow label="Threshold overrides" hint="Per-client overrides of default rule thresholds.">
        <ThresholdOverridesInput values={thresholdOverrides} onChange={setThresholdOverrides} />
      </CfgRow>

      <CfgRow label="Standing directives" hint="Shown on every task generated for this client." last>
        <input
          value={standingDirectives}
          onChange={(e) => setStandingDirectives(e.target.value)}
          placeholder="e.g. Client wants brand defense always on; no budget cuts on SB | Brand Defense."
          className={`${inputCls} w-full max-w-130`}
        />
      </CfgRow>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-ink px-4 py-2.5 text-[13px] font-semibold text-brand transition-colors hover:bg-ink/90 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save configuration"}
        </button>
        {saved && <span className="text-[12px] text-green-700">Saved.</span>}
        {saveError && <span className="text-[12px] text-red-600">{saveError}</span>}
        <span className="text-[11.5px] text-neutral-400">Tasks generate only when configuration is complete.</span>
      </div>
    </div>
  );
}
