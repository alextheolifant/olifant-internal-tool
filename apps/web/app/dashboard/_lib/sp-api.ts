import { apiFetch } from "@/lib/api";

export type SpApiRegion = "na" | "eu" | "fe";

export const SP_API_REGIONS: { value: SpApiRegion; label: string }[] = [
  { value: "na", label: "NA (US/CA/MX)" },
  { value: "eu", label: "EU (UK/DE/FR/IT/ES)" },
  { value: "fe", label: "FE (JP/AU/SG)" },
];

export const SP_API_REGION_LABELS: Record<string, string> = Object.fromEntries(
  SP_API_REGIONS.map((r) => [r.value, r.label]),
);

export interface ConnectAmazonResponse {
  authorizationUrl: string;
  region: string;
}

// Thrown specifically when a client spans multiple regions and the backend
// needs an explicit ?region= to disambiguate — lets the UI show a region
// picker instead of just a dead-end error message.
export class RegionAmbiguousError extends Error {}

export async function connectClientAmazonAccount(
  clientId: string,
  opts?: { region?: string },
): Promise<ConnectAmazonResponse> {
  const qs = new URLSearchParams();
  if (opts?.region) qs.set("region", opts.region);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";

  const res = await apiFetch(`/api/sp-api/connect/${clientId}${suffix}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message =
      body && typeof body === "object" && typeof (body as { message?: unknown }).message === "string"
        ? (body as { message: string }).message
        : `HTTP ${res.status}`;
    if (message.includes("multiple regions")) throw new RegionAmbiguousError(message);
    throw new Error(message);
  }
  return res.json();
}
