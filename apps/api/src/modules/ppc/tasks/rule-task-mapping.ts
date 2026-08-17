import type { TaskAction, TaskConfidence, TaskType } from './task.types';

// ─── Rule → task content mapping ────────────────────────────────────────────
// Given one rule's fired evidence, decides everything about the resulting
// task that ISN'T mechanical: what kind of action it is, what field is
// changing (if any) and to what value, a plain-language rollback, and a
// real-data-backed impact estimate. Instruction rendering is a separate
// concern (instruction-templates.ts) — this only decides content.

export interface RuleTaskContent {
  type: TaskType;
  title: string;
  action: TaskAction;
  rollback: string;
  impactMonthlyUsd: number | null;
  impactBasis: string | null;
  confidence: TaskConfidence;
}

type Mapper = (evidence: Record<string, unknown>, entityId: string) => RuleTaskContent;

function str(v: unknown, fallback = 'Unnamed campaign'): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function fmt(v: number | null, digits = 1): string {
  return v === null ? 'unknown' : v.toFixed(digits);
}

// D1 — suggested increase is the low end of the brief's own "+25-50%" range.
// Conservative default; a human can always go further, the instructions
// state the exact suggested number either way.
const D1_BUDGET_INCREASE_PCT = 0.25;

const MAPPERS: Record<string, Mapper> = {
  D1: (evidence, entityId) => {
    const campaignName = str(evidence.campaignName);
    const currentBudget = num(evidence.currentBudget);
    const newBudget = currentBudget !== null ? Math.round(currentBudget * (1 + D1_BUDGET_INCREASE_PCT) * 100) / 100 : null;
    const acos = num(evidence.trailing30dAcos);
    const be = num(evidence.be);

    // Additional daily spend capacity unlocked, at the same (already
    // profitable) ACOS — extrapolated to a month. Not "profit" — the extra
    // spend converts to sales at roughly this campaign's own ratio, which is
    // favorable specifically because trailing ACOS < BE (checked below by
    // the rule itself before this ever fires).
    const impactMonthlyUsd =
      currentBudget !== null && newBudget !== null ? (newBudget - currentBudget) * 30 : null;

    return {
      type: 'budget',
      title: `Out of budget, profitable — "${campaignName}" capped at ${fmt(acos)}% ACOS vs ${fmt(be)}% BE`,
      action: {
        entityType: 'campaign',
        campaignId: entityId,
        campaignName,
        adGroupId: null,
        oldValue: currentBudget,
        newValue: newBudget,
        // Dotted path into the campaign snapshot's flattened state — see
        // entity_snapshots_daily's real shape: {"budget": {"budget": N,
        // "budgetType": "DAILY"}}. Matches flattenJSON's own convention
        // exactly (entity-diff.service.ts), so verification and the ledger
        // can read the same key the diff engine would produce.
        field: 'budget.budget',
      },
      rollback: currentBudget !== null
        ? `Set the daily budget back to $${currentBudget.toFixed(2)}.`
        : 'Set the daily budget back to its value before this change.',
      impactMonthlyUsd,
      impactBasis: `current daily budget × ${D1_BUDGET_INCREASE_PCT * 100}% suggested increase × 30 days — additional monthly spend capacity unlocked at the same profitable ACOS`,
      // 30-day trailing window is a large enough sample whenever this
      // actually fires — see D4 for the confidence rationale pattern.
      confidence: 'high',
    };
  },

  D4: (evidence, entityId) => {
    const campaignName = str(evidence.campaignName);
    const acos = num(evidence.trailing7dAcos);
    const be = num(evidence.be);
    const spend = num(evidence.trailing7dSpend);
    const sales = num(evidence.trailing7dSales);
    const minSpend = num(evidence.minSpend);

    // Excess spend vs. what the same sales would have cost at a BE-level
    // ACOS, extrapolated from the 7d trailing window to a month.
    const wastedSpend7d =
      be !== null && spend !== null && sales !== null ? spend - (sales * be) / 100 : null;
    const impactMonthlyUsd = wastedSpend7d !== null ? Math.max(0, wastedSpend7d) * (30 / 7) : null;

    // Sample-size-driven confidence: how far past the minimum spend gate
    // this campaign actually is. Right at the gate ($50 default) is a
    // thinner sample than 3x+ that.
    const spendMultiple = spend !== null && minSpend ? spend / minSpend : null;
    const confidence: TaskConfidence = spendMultiple !== null && spendMultiple >= 3 ? 'high' : 'medium';

    return {
      type: 'investigate',
      title: `ACOS blowout — "${campaignName}" running ${fmt(acos)}% ACOS vs ${fmt(be)}% BE`,
      action: {
        entityType: 'campaign',
        campaignId: entityId,
        campaignName,
        adGroupId: null,
        oldValue: null,
        newValue: null,
        field: null, // diagnostic — no field-level change proposed
      },
      rollback: 'Diagnostic task — no system change is made by executing it. Nothing to roll back.',
      impactMonthlyUsd,
      impactBasis: 'trailing 7d spend vs. BE-implied spend for the same sales, extrapolated ×30/7',
      confidence,
    };
  },

  D5: (evidence, entityId) => {
    const campaignName = str(evidence.campaignName);
    const impressionsYesterday = num(evidence.impressionsYesterday) ?? 0;
    const daysMeetingBar = num(evidence.trailingBaselineDaysMeetingBar);
    const baselineAvgDailySales = num(evidence.baselineAvgDailySales);

    // Projects the campaign's own pre-stoppage average daily sales (over
    // just the qualifying baseline days) forward a month, as the estimated
    // lost revenue while delivery stays stopped.
    const impactMonthlyUsd = baselineAvgDailySales !== null ? baselineAvgDailySales * 30 : null;

    // Sample-size-driven confidence: how many of the 7 baseline days
    // actually met the "meaningfully serving" bar (minimum 4 to fire at all).
    const confidence: TaskConfidence =
      daysMeetingBar !== null && daysMeetingBar >= 7
        ? 'high'
        : daysMeetingBar !== null && daysMeetingBar >= 5
          ? 'medium'
          : 'provisional';

    return {
      type: 'investigate',
      title: `Delivery stopped — "${campaignName}" had ${impressionsYesterday} impression${impressionsYesterday === 1 ? '' : 's'} yesterday after serving normally`,
      action: {
        entityType: 'campaign',
        campaignId: entityId,
        campaignName,
        adGroupId: null,
        oldValue: null,
        newValue: null,
        field: null, // diagnostic — no field-level change proposed
      },
      rollback: 'Diagnostic task — no system change is made by executing it. Nothing to roll back.',
      impactMonthlyUsd,
      impactBasis: 'baseline average daily sales (qualifying days only) × 30 — projects the pre-stoppage run-rate forward',
      confidence,
    };
  },

  // W1 — Zero-sale negation. The proposed action is a NEGATIVE EXACT keyword
  // in one campaign, never account-wide (see w1-zero-sale-negation.rule.ts's
  // Guard 1). entityId here is the composite (campaign::term) id, so the
  // term is read from evidence rather than parsed back out of it.
  W1: (evidence) => {
    const term = str(evidence.searchTerm, 'unknown term');
    const campaignName = str(evidence.campaignName);
    const campaignId = str(evidence.campaignId, '');
    const adGroupId = typeof evidence.adGroupId === 'string' ? evidence.adGroupId : null;
    const clicks = num(evidence.clicks) ?? 0;
    const cost = num(evidence.cost) ?? 0;
    const expected = num(evidence.expectedClicksPerOrder);
    const monthlyWaste = num(evidence.monthlyWaste);
    const winners = Array.isArray(evidence.winnersElsewhere) ? evidence.winnersElsewhere : [];

    // Confidence reflects how far past the bar the term is, and whether the
    // winner cross-check found competing evidence. A term converting
    // elsewhere isn't a reason NOT to negate it here — the per-campaign
    // failure is real — but it is a reason for a human to look before
    // acting, so it caps confidence at medium.
    const ratio = expected !== null && expected > 0 ? clicks / expected : null;
    const confidence: TaskConfidence =
      winners.length > 0 ? 'medium' : ratio !== null && ratio >= 4 ? 'high' : 'medium';

    return {
      type: 'negation',
      title: `Zero-sale term — negate "${term}" in "${campaignName}" (${clicks} clicks, $${cost.toFixed(2)}, 0 orders)`,
      action: {
        entityType: 'search_term',
        campaignId,
        campaignName,
        adGroupId,
        // The term isn't currently negated; the proposed state is a negative
        // exact keyword. oldValue/newValue describe that transition.
        oldValue: null,
        newValue: 'NEGATIVE_EXACT',
        field: 'negative_keyword',
      },
      rollback: `Remove the negative exact keyword "${term}" from ${adGroupId ? `ad group ${adGroupId} in ` : ''}campaign "${campaignName}".`,
      impactMonthlyUsd: monthlyWaste,
      impactBasis: `${String(evidence.windowStart)}–${String(evidence.windowEnd)} spend on this term with zero orders, expressed as a monthly run-rate`,
      confidence,
    };
  },

  D3: (evidence, entityId) => {
    const campaignName = str(evidence.campaignName);
    const oldValue = evidence.oldValue;

    return {
      type: 'investigate',
      title: `Unintended pause — "${campaignName}" was paused outside the task queue`,
      action: {
        entityType: 'campaign',
        campaignId: entityId,
        campaignName,
        adGroupId: null,
        oldValue: typeof oldValue === 'string' ? oldValue : null,
        newValue: null,
        field: null, // diagnostic — go investigate why, not a specific proposed value
      },
      rollback:
        'Diagnostic task — no system change is made by executing it. Re-enable the campaign in the Ads console if the pause was unintended.',
      // No reliable dollar baseline at detection time — D5 (delivery
      // stopped) already covers "lost sales while stopped" once enough
      // post-pause data exists; D3's own value is catching the pause fast,
      // not re-deriving D5's estimate.
      impactMonthlyUsd: null,
      impactBasis: null,
      // The pause itself is a hard fact straight from the diff engine
      // (entity_snapshots_daily comparison), not an inference — high
      // confidence regardless of category.
      confidence: 'high',
      // Not part of RuleTaskContent's shape but worth noting here: evidence
      // keeps ledgerEntryId (see d3-unintended-pause.rule.ts) so the task's
      // evidence payload always points at exactly which ledger row
      // triggered it, per the brief's "Evidence should include the ledger
      // entry id" — carried through automatically since buildEvidence
      // wraps the rule's raw evidence unmodified.
    };
  },
};

export function mapCandidateToTaskContent(
  ruleId: string,
  entityId: string,
  evidence: Record<string, unknown>,
): RuleTaskContent {
  const mapper = MAPPERS[ruleId];
  if (!mapper) {
    throw new Error(
      `No task-content mapping registered for rule ${ruleId} — add one alongside the rule, per the same convention as instruction templates.`,
    );
  }
  return mapper(evidence, entityId);
}
