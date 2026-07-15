import { apiFetch } from "@/lib/api";

export interface ConnectAmazonResponse {
  authorizationUrl: string;
}

export async function connectClientAmazonAccount(
  clientId: string,
  opts?: { marketplace?: string; region?: string },
): Promise<ConnectAmazonResponse> {
  const qs = new URLSearchParams();
  if (opts?.marketplace) qs.set("marketplace", opts.marketplace);
  if (opts?.region) qs.set("region", opts.region);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";

  const res = await apiFetch(`/api/sp-api/connect/${clientId}${suffix}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message =
      body && typeof body === "object" && typeof (body as { message?: unknown }).message === "string"
        ? (body as { message: string }).message
        : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return res.json();
}
