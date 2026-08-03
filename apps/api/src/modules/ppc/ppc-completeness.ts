// ─── PPC Engine: client config completeness ────────────────────────────────────
// Explicit, adjustable definition of what "fully configured" means for a PPC
// client. A client below 100% shows the hard-gate locked state ("Optimization
// paused — configuration incomplete") on the Clients screen. Keep the
// checklist here, not scattered inline, so it's easy to extend later.

export interface ProductEconomicsCheck {
  strategy: string | null;
  targetAcos: number | null;
  targetTacos: number | null;
  launchUntil: string | null;
}

export interface PpcConfigCompletenessInput {
  monthlyAdBudget: number | null;
  // The bid-math fallback default (Account default economics).
  targetAcosDefault: number | null;
  // The account-level rollup/reporting target (Account target metric) — a
  // separate, independent number from targetAcosDefault; either counts as
  // "a default target is set."
  accountTargetMetricValue: number | null;
  products: ProductEconomicsCheck[];
}

export interface CompletenessChecklistItem {
  key: string;
  label: string;
  met: boolean;
}

export interface PpcConfigCompleteness {
  percent: number;
  checklist: CompletenessChecklistItem[];
}

function isProductConfigured(p: ProductEconomicsCheck): boolean {
  const hasTarget = p.strategy !== null && (p.targetAcos !== null || p.targetTacos !== null);
  // launch is time-boxed by definition — a launch row with no end date can't
  // auto-flip to growth, so it isn't considered fully configured yet.
  const launchDated = p.strategy !== 'launch' || p.launchUntil !== null;
  return hasTarget && launchDated;
}

export function computePpcConfigCompleteness(
  input: PpcConfigCompletenessInput,
): PpcConfigCompleteness {
  const hasProducts = input.products.length > 0;
  const allProductsConfigured = hasProducts && input.products.every(isProductConfigured);

  const checklist: CompletenessChecklistItem[] = [
    {
      key: 'monthlyAdBudget',
      label: 'Monthly ad budget set',
      met: input.monthlyAdBudget !== null,
    },
    {
      key: 'accountDefaultTarget',
      label: 'Account default target set (ACOS or TACOS)',
      met: input.targetAcosDefault !== null || input.accountTargetMetricValue !== null,
    },
    {
      key: 'productEconomics',
      label: 'Every product has a strategy and at least one target',
      met: allProductsConfigured,
    },
  ];

  const metCount = checklist.filter((c) => c.met).length;
  const percent = Math.round((metCount / checklist.length) * 100);

  return { percent, checklist };
}
