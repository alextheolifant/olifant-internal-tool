import { healthTokens } from "../../_lib/theme";
import type { PpcClientFreshness } from "../_lib/ppc-clients-api";

export function freshnessText(iso: string | null): string {
  if (!iso) return "never synced";
  const ms = Date.now() - new Date(iso).getTime();
  const hours = Math.floor(ms / (60 * 60 * 1000));
  if (hours < 1) return "<1h ago";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function FreshnessBadge({ freshness }: { freshness: PpcClientFreshness }) {
  const t = healthTokens[freshness.level];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${t.text}`}>
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.dot}`} />
      Synced {freshnessText(freshness.lastSyncedAt)}
    </span>
  );
}
