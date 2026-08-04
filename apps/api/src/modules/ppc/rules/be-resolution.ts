import type { ResolvedBE } from './types';

// ─── BE (break-even ACOS) resolution ────────────────────────────────────────
// The brief's full resolution chain is:
//   1. Single-ASIN campaign  -> that product_economics row's BE (margin)
//   2. Multi-ASIN campaign   -> spend-weighted BE across its ASINs
//   3. Fallback              -> client account default (ppc_client_configs
//                               .marginDefault), flagged as a fallback
//
// Steps 1-2 are NOT implemented: resolving BE per campaign requires knowing
// which ASINs a campaign advertises, and that campaign->ASIN mapping needs a
// Product Ads sync, which doesn't exist in this codebase yet (sync-ads-api
// only syncs profiles/campaigns/metrics — no product-ad/targeting-level
// data). So every campaign resolves to step 3 today, always flagged.
//
// TODO(product-ads-sync): once campaign->ASIN mapping exists, resolve steps
// 1-2 first per campaign and only fall through to the account default when a
// campaign genuinely has no product_economics coverage.
export function resolveAccountBE(marginDefault: number | null): ResolvedBE {
  if (marginDefault === null) return { value: null, isFallback: false };
  return { value: marginDefault, isFallback: true };
}
