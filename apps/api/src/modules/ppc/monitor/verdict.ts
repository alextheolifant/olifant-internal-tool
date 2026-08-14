import type { TaskType } from '../tasks/task.types';
import type { MonitorFlag, MonitorVerdict, NormalizedComparison, WindowMetrics } from './monitor.types';
import { buildSpendSummary, conservativeSavingsMonthly, fmtMoney, fmtSignedPct } from './normalization';

// ─── Per-task-type verdict logic ────────────────────────────────────────────
// Different task types measure different things (the brief's table):
//
//   negation / pause  spend eliminated = verified savings; campaign ACOS
//                     delta as the side-effect check
//   bid_change        Δ entity spend/sales/ACOS vs baseline, plus an
//                     impressions-collapse flag (bid cut too deep)
//   budget            Δ campaign sales vs Δ spend; capped-days before/after
//   harvest_launch    destination target sales/ACOS from day 0
//
// IMPLEMENTATION REALITY, stated rather than papered over: no registered
// rule currently produces negation, pause, bid_change, budget, or
// harvest_launch tasks. D1 emits `budget` but can never fire (no
// budget-capped signal is synced — see d1-out-of-budget-profitable.rule.ts);
// D3/D4/D5 all emit `investigate`, and G-guards aren't registered at all.
// So every branch below except `investigate` is structure built ahead of the
// W-rules and G-guards that will exercise it, and is UNTESTED against real
// task data — the same caveat the brief already grants harvest/bid-change,
// which in practice extends to negation/pause/budget too.

export interface VerdictInputs {
  taskType: TaskType;
  /** action.field — null for diagnostic tasks that changed nothing. */
  actionField: string | null;
  entityLabel: string;
  entityPre: WindowMetrics | null;
  entityPost: WindowMetrics | null;
  campaignPre: WindowMetrics;
  campaignPost: WindowMetrics;
  spendComparison: NormalizedComparison | null;
  campaignAcosNormalizedPct: number | null;
  campaignAcosRawPct: number | null;
  flagThresholds: { acosDeteriorationPct: number; impressionDropPct: number };
}

export interface VerdictBody {
  verifiedSavingsMonthly: number | null;
  flags: MonitorFlag[];
  summary: string;
  notMeasurable: string | null;
}

/** Task types whose whole point is eliminating spend. */
const SPEND_ELIMINATING: TaskType[] = ['negation', 'pause'];

export function buildVerdictBody(i: VerdictInputs): VerdictBody {
  const flags = collectFlags(i);

  // A task that proposed no field change made no change to attribute an
  // outcome to. The monitor still records observed movement (the caller
  // stores full entity/campaign windows either way) but must not imply the
  // task caused it.
  if (i.actionField === null) {
    return {
      verifiedSavingsMonthly: null,
      flags,
      summary: diagnosticSummary(i),
      notMeasurable:
        `Task type '${i.taskType}' proposed no field change (action.field is null), so no before/after effect can be attributed to it. ` +
        `Campaign movement below is observational context only.`,
    };
  }

  if (SPEND_ELIMINATING.includes(i.taskType)) return spendEliminatingVerdict(i, flags);
  if (i.taskType === 'bid_change') return bidChangeVerdict(i, flags);
  if (i.taskType === 'budget') return budgetVerdict(i, flags);
  if (i.taskType === 'harvest_launch') return harvestVerdict(i, flags);

  return {
    verifiedSavingsMonthly: null,
    flags,
    summary: `${i.entityLabel}: ${genericMovement(i)} No type-specific verdict logic is registered for '${i.taskType}'.`,
    notMeasurable: null,
  };
}

// Negation / pause — spend eliminated is the verified saving; the campaign's
// ACOS delta is the side-effect check that catches spend simply migrating to
// worse targets inside the same campaign.
function spendEliminatingVerdict(i: VerdictInputs, flags: MonitorFlag[]): VerdictBody {
  if (!i.spendComparison) {
    return {
      verifiedSavingsMonthly: null,
      flags,
      summary: `${i.entityLabel}: no entity-level fact data available, so eliminated spend cannot be measured.`,
      notMeasurable: 'No fact table covers this entity type — see monitor-facts.repository.ts.',
    };
  }
  const savings = conservativeSavingsMonthly(i.spendComparison);
  const summary = `${buildSpendSummary(i.entityLabel, i.spendComparison, savings)} ${campaignSideEffect(i)}`;
  return { verifiedSavingsMonthly: savings, flags, summary, notMeasurable: null };
}

// Bid change — Δ spend / sales / ACOS against the pre-change baseline. The
// impressions-collapse flag (raised in collectFlags) is what feeds a
// follow-up W3 candidate once W-rules exist.
function bidChangeVerdict(i: VerdictInputs, flags: MonitorFlag[]): VerdictBody {
  if (!i.entityPre || !i.entityPost || !i.spendComparison) {
    return {
      verifiedSavingsMonthly: null,
      flags,
      summary: `${i.entityLabel}: no entity-level fact data available, so the bid change's effect cannot be measured.`,
      notMeasurable: 'No fact table covers this entity type — see monitor-facts.repository.ts.',
    };
  }
  const c = i.spendComparison;
  const spendPart = c.normalized
    ? `spend ${fmtMoney(c.entityPostDaily)}/day vs ${fmtMoney(c.counterfactualDaily as number)}/day expected on account trend (${fmtSignedPct(c.accountMovementPct as number)})`
    : `spend ${fmtMoney(c.entityPostDaily)}/day vs ${fmtMoney(c.entityPreDaily)}/day before — trend baseline insufficient, raw comparison shown`;

  const salesPart = `sales ${fmtMoney(i.entityPost.dailySales)}/day (was ${fmtMoney(i.entityPre.dailySales)}/day)`;
  const acosPart =
    i.entityPost.acos !== null && i.entityPre.acos !== null
      ? `, ACOS ${i.entityPost.acos.toFixed(1)}% (was ${i.entityPre.acos.toFixed(1)}%)`
      : '';
  const collapsed = flags.some((f) => f.kind === 'impressions_collapsed')
    ? ' Impressions collapsed — bid likely cut too deep; a follow-up review task has been raised.'
    : '';

  return {
    verifiedSavingsMonthly: null, // a bid change reallocates spend; it doesn't "save" it
    flags,
    summary: `${i.entityLabel}: ${spendPart}, ${salesPart}${acosPart}.${collapsed} ${campaignSideEffect(i)}`,
    notMeasurable: null,
  };
}

// Budget — Δ campaign sales against Δ campaign spend.
//
// GAP: "capped-days before vs after" is part of the brief's budget verdict
// and is NOT computed here. No out-of-budget / budget-capped signal is
// synced anywhere in this platform — the same missing field that makes D1
// unfireable (confirmed against 27k+ campaigns' raw_data in that rule's own
// investigation). Stating the gap rather than substituting a proxy that
// would read as a real capped-day count.
function budgetVerdict(i: VerdictInputs, flags: MonitorFlag[]): VerdictBody {
  const spendDelta = i.campaignPost.dailySpend - i.campaignPre.dailySpend;
  const salesDelta = i.campaignPost.dailySales - i.campaignPre.dailySales;
  const ratio =
    spendDelta > 0 ? ` Each extra ${fmtMoney(1)} of daily spend returned ${fmtMoney(salesDelta / spendDelta)} in daily sales.` : '';

  return {
    verifiedSavingsMonthly: null,
    flags,
    summary:
      `Campaign daily spend ${spendDelta >= 0 ? 'up' : 'down'} ${fmtMoney(spendDelta)}, daily sales ${salesDelta >= 0 ? 'up' : 'down'} ${fmtMoney(salesDelta)} ` +
      `since execution.${ratio} ${campaignSideEffect(i)} ` +
      `Capped-days before/after not included: no out-of-budget signal is synced (same gap that blocks D1).`,
    notMeasurable: null,
  };
}

// Harvest — destination target sales and ACOS from day 0. The paired
// source-term negation is a separate task with its own monitor, so the
// "source term spend after the paired negation executes" half of the brief's
// definition is measured there rather than duplicated here.
function harvestVerdict(i: VerdictInputs, flags: MonitorFlag[]): VerdictBody {
  if (!i.entityPost) {
    return {
      verifiedSavingsMonthly: null,
      flags,
      summary: `${i.entityLabel}: no entity-level fact data available for the destination target.`,
      notMeasurable: 'No fact table covers this entity type — see monitor-facts.repository.ts.',
    };
  }
  const acos = i.entityPost.acos !== null ? `${i.entityPost.acos.toFixed(1)}% ACOS` : 'no ACOS (no spend or no sales yet)';
  return {
    verifiedSavingsMonthly: null,
    flags,
    summary:
      `Destination target since launch: ${fmtMoney(i.entityPost.sales)} sales on ${fmtMoney(i.entityPost.spend)} spend (${acos}). ` +
      `Source-term spend after the paired negation is measured on that negation's own monitor. ${campaignSideEffect(i)}`,
    notMeasurable: null,
  };
}

function collectFlags(i: VerdictInputs): MonitorFlag[] {
  const flags: MonitorFlag[] = [];

  // Campaign ACOS deterioration — read from the NORMALIZED delta wherever
  // one exists, per the brief, so an account-wide seasonal swing can't fire
  // a false alarm. Falls back to raw only when no trend baseline could be
  // established, and says so in the detail text.
  const acosPct = i.campaignAcosNormalizedPct ?? i.campaignAcosRawPct;
  const acosBasis = i.campaignAcosNormalizedPct !== null ? 'normalized' : 'raw (trend baseline insufficient)';
  if (acosPct !== null && acosPct > i.flagThresholds.acosDeteriorationPct) {
    flags.push({
      kind: 'campaign_acos_deterioration',
      detail: `Parent campaign's ACOS deteriorated ${acosPct.toFixed(0)}% versus baseline (${acosBasis}), past the ${i.flagThresholds.acosDeteriorationPct}% threshold.`,
      observed: acosPct,
      threshold: i.flagThresholds.acosDeteriorationPct,
    });
  }

  // Impressions collapse on a repriced target.
  if (i.taskType === 'bid_change' && i.entityPre && i.entityPost && i.entityPre.impressions > 0) {
    const dropPct = ((i.entityPre.impressions - i.entityPost.impressions) / i.entityPre.impressions) * 100;
    if (dropPct > i.flagThresholds.impressionDropPct) {
      flags.push({
        kind: 'impressions_collapsed',
        detail: `Repriced target's impressions fell ${dropPct.toFixed(0)}% (${i.entityPre.impressions} → ${i.entityPost.impressions}), past the ${i.flagThresholds.impressionDropPct}% threshold — bid likely cut too deep.`,
        observed: dropPct,
        threshold: i.flagThresholds.impressionDropPct,
      });
    }
  }

  return flags;
}

function campaignSideEffect(i: VerdictInputs): string {
  const pct = i.campaignAcosNormalizedPct ?? i.campaignAcosRawPct;
  if (pct === null) {
    return `Parent campaign ACOS change could not be computed (no spend or no sales in one of the windows).`;
  }
  const basis = i.campaignAcosNormalizedPct !== null ? 'net of account trend' : 'raw — trend baseline insufficient';
  const direction = pct >= 0 ? 'worsened' : 'improved';
  return `Parent campaign ACOS ${direction} ${Math.abs(pct).toFixed(0)}% (${basis}).`;
}

function genericMovement(i: VerdictInputs): string {
  return `campaign daily spend ${fmtMoney(i.campaignPre.dailySpend)} → ${fmtMoney(i.campaignPost.dailySpend)}, daily sales ${fmtMoney(i.campaignPre.dailySales)} → ${fmtMoney(i.campaignPost.dailySales)}.`;
}

function diagnosticSummary(i: VerdictInputs): string {
  return `Diagnostic task — no system change was made, so nothing is attributed to it. Observed since execution: ${genericMovement(i)} ${campaignSideEffect(i)}`;
}
