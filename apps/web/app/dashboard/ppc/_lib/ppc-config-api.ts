import { apiFetch } from "@/lib/api";
import type { PpcConfigChecklistItem } from "./ppc-clients-api";

export type PpcStrategy = "launch" | "growth" | "maintain";

export interface SbObjective {
  campaignName: string;
  objective: "performance" | "defense" | "ntb";
}

export interface HarvestDestination {
  asin: string;
  campaignName: string;
  maxTargets: number | null;
}

export interface ProductEconomicsRow {
  id: string;
  asin: string;
  productName: string | null;
  margin: number | null;
  strategy: PpcStrategy | null;
  targetAcos: number | null;
  targetTacos: number | null;
  launchUntil: string | null;
}

export interface PpcAdsAccount {
  profileId: string;
  accountName: string | null;
  marketplace: string | null;
}

export interface PpcConfig {
  clientId: string;
  opsStatus: "active" | "frozen";
  adsAccounts: PpcAdsAccount[];
  monthlyAdBudget: number | null;
  marginDefault: number | null;
  targetAcosDefault: number | null;
  accountTargetMetric: "acos" | "tacos";
  accountTargetMetricValue: number | null;
  brandTerms: string[];
  ownAsins: string[];
  sbObjectives: SbObjective[];
  harvestDestinationCampaigns: HarvestDestination[];
  thresholdOverrides: Record<string, number>;
  standingDirectives: string | null;
  conservativeMode: boolean;
  products: ProductEconomicsRow[];
  completeness: { percent: number; checklist: PpcConfigChecklistItem[] };
}

export type UpdatePpcConfigInput = Partial<{
  opsStatus: "active" | "frozen";
  monthlyAdBudget: number | null;
  marginDefault: number | null;
  targetAcosDefault: number | null;
  accountTargetMetric: "acos" | "tacos";
  accountTargetMetricValue: number | null;
  brandTerms: string[];
  ownAsins: string[];
  sbObjectives: SbObjective[];
  harvestDestinationCampaigns: HarvestDestination[];
  thresholdOverrides: Record<string, number>;
  standingDirectives: string | null;
  conservativeMode: boolean;
}>;

export interface ProductEconomicsInput {
  asin: string;
  productName?: string | null;
  margin?: number | null;
  strategy?: PpcStrategy | null;
  targetAcos?: number | null;
  targetTacos?: number | null;
  launchUntil?: string | null;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchPpcConfig(clientId: string, signal?: AbortSignal): Promise<PpcConfig> {
  const res = await apiFetch(`/api/ppc/config/${clientId}`, { cache: "no-store", signal });
  return json(res);
}

export async function updatePpcConfig(
  clientId: string,
  patch: UpdatePpcConfigInput,
): Promise<PpcConfig> {
  const res = await apiFetch(`/api/ppc/config/${clientId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return json(res);
}

export async function createProductEconomics(
  clientId: string,
  input: ProductEconomicsInput,
): Promise<ProductEconomicsRow> {
  const res = await apiFetch(`/api/ppc/config/${clientId}/products`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return json(res);
}

export async function updateProductEconomics(
  id: string,
  patch: Partial<Omit<ProductEconomicsInput, "asin">>,
): Promise<ProductEconomicsRow> {
  const res = await apiFetch(`/api/ppc/config/products/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return json(res);
}

export async function deleteProductEconomics(id: string): Promise<void> {
  const res = await apiFetch(`/api/ppc/config/products/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}
