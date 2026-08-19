import type { TaskAction, TaskType } from './task.types';

// ─── Instruction templates ──────────────────────────────────────────────────
// One numbered, console-literal instruction list per (rule, action type)
// pair. The brief's standard: "No task may require the executor to look
// anything up outside the task card — the card is self-contained." Every
// number quoted below comes from this task's own action/evidence, embedded
// directly into the instruction text — never "see evidence above."
//
// Adding a new (rule, action type) is registering one more entry in
// TEMPLATES below — nothing here branches on rule identity beyond that map
// lookup.

export interface InstructionContext {
  action: TaskAction;
  evidence: Record<string, unknown>;
}

type InstructionTemplate = (ctx: InstructionContext) => string[];

const MARK_EXECUTED =
  'Mark this task Executed — the next sync verifies the change automatically.';

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function money(v: number | null): string {
  return v === null ? 'unknown' : v.toFixed(2);
}
function pct(v: unknown, digits = 1): string {
  return typeof v === 'number' ? v.toFixed(digits) : 'unknown';
}

// W1 helpers — the expectation figure and the winner list both need to read
// as plain English inside an instruction step.
function fmtExpected(evidence: Record<string, unknown>): string {
  const v = num(evidence.expectedClicksPerOrder);
  return v === null ? 'expected' : v.toFixed(1);
}

function describeWinners(winners: unknown[]): string {
  return winners
    .slice(0, 3)
    .map((w) => {
      const o = w as {
        kind?: string;
        campaignName?: string | null;
        campaignId?: string;
        orders?: number;
      };
      const where = o.campaignName ?? o.campaignId ?? 'another campaign';
      const kind =
        o.kind === 'enabled_exact_target'
          ? 'enabled exact target'
          : 'search term';
      return `${kind} in "${where}" with ${o.orders ?? 0} order(s)`;
    })
    .join('; ');
}

const TEMPLATES: Record<string, InstructionTemplate> = {
  // D1 — Out of budget, profitable: raise the daily budget by a stated
  // amount. Not yet exercised by real data (see d1-out-of-budget-profitable
  // .rule.ts) but built now so nothing needs to change here once it is.
  'D1:budget': ({ action }) => [
    `Open campaign '${action.campaignName}' in the Ads console.`,
    `Go to Budget.`,
    `Change the daily budget from $${money(typeof action.oldValue === 'number' ? action.oldValue : null)} to $${money(typeof action.newValue === 'number' ? action.newValue : null)}.`,
    `Save.`,
    MARK_EXECUTED,
  ],

  // D4 — ACOS blowout: no single deterministic field change exists at
  // campaign-level granularity (no keyword/placement-level data is synced),
  // so this stays a guided review — but every number quoted is this task's
  // own evidence, not a prompt to go find them.
  'D4:investigate': ({ action, evidence }) => [
    `Open campaign '${action.campaignName}' in the Ads console.`,
    `Open the Search term report and the Placement report, date range ${String(evidence.windowStart)} – ${String(evidence.windowEnd)}.`,
    `This campaign spent $${money(num(evidence.trailing7dSpend))} for $${money(num(evidence.trailing7dSales))} in sales over that window — ${pct(evidence.trailing7dAcos)}% ACOS against a ${pct(evidence.be)}% break-even target (${pct(evidence.multiplier, 1)}× over).`,
    `In those two reports, find the search terms or placements responsible for the spend that isn't converting.`,
    `Pause or reduce bids on the worst offenders you find. If no single driver stands out, reduce this campaign's overall budget or bids instead.`,
    MARK_EXECUTED,
  ],

  // W1 — Zero-sale negation. Scoped to ONE campaign by construction; the
  // instructions say so out loud, because the single most damaging way to
  // execute this task wrong is to add the negative at account level or in
  // the wrong campaign. The winner cross-check's finding is stated inline
  // rather than left in evidence, since that's the context that stops
  // someone broadening the negation while they're in the console.
  'W1:negation': ({ action, evidence }) => {
    const term = String(evidence.searchTerm ?? '');
    const winners = Array.isArray(evidence.winnersElsewhere)
      ? evidence.winnersElsewhere
      : [];
    const steps = [
      `Open campaign '${action.campaignName}' in the Ads console.${action.adGroupId ? ` Go to ad group ${action.adGroupId}.` : ''}`,
      `Open the Negative keywords tab.`,
      `Add a negative keyword with match type "Negative exact" and text exactly: ${term}`,
      `This term took ${String(evidence.clicks)} clicks and $${money(num(evidence.cost))} with 0 orders between ${String(evidence.windowStart)} and ${String(evidence.windowEnd)}. That is ${pct(evidence.clicksMultiple, 1)}× the ${fmtExpected(evidence)} clicks-per-order expected for this ${String(evidence.expectationBasis ?? 'ad group')}, with nothing to show for it.`,
    ];

    if (winners.length > 0) {
      steps.push(
        `HEADS UP — this exact term IS converting elsewhere in this account (${winners.length} place(s): ${describeWinners(winners)}). ` +
          `Add the negative ONLY in '${action.campaignName}'. Do not add it at account level and do not add it in those campaigns, or you will kill working traffic.`,
      );
    } else {
      steps.push(
        `The winner cross-check found this term converting nowhere else in the account. Still add the negative only in '${action.campaignName}' — W1 never proposes account-wide negation.`,
      );
    }

    steps.push(`Save.`, MARK_EXECUTED);
    return steps;
  },

  // D3 — Unintended pause: the pause itself is a hard fact from the diff
  // engine (see d3-unintended-pause.rule.ts), but WHY it happened isn't —
  // no signal in the synced data says "a human did this" vs. "Amazon's
  // automation did this" vs. "a bulk tool did this" (see ledger.service.ts's
  // conservative category inference). Guided review, same shape as D4/D5.
  'D3:investigate': ({ action, evidence }) => [
    `Open campaign '${action.campaignName}' in the Ads console.`,
    `Confirm it is currently Paused — last detected ${String(evidence.detectedAt)}, changed from Enabled to Paused with no task in the queue proposing that change.`,
    `Check the campaign's change history in the Ads console (if available) for who/what made the change.`,
    `If the pause was unintended, re-enable the campaign. If it was intentional (a deliberate manual pause, a bulk edit, or a legitimate reason not tracked here), note that instead.`,
    MARK_EXECUTED,
  ],

  // D5 — Delivery stopped: diagnostic only, cause unknown by design (see
  // rule comment) — the card states plainly what is and isn't known instead
  // of implying a specific cause the data can't actually confirm.
  'D5:investigate': ({ action, evidence }) => [
    `Open campaign '${action.campaignName}' in the Ads console.`,
    `Check Campaign status: confirm it is Enabled and has no policy or ad-eligibility warnings. (Last synced state was Enabled as of ${String(evidence.yesterdayDate)}, but this task's data cannot see Amazon's live status — verify directly.)`,
    `Check the Budget tab for an "Out of budget" flag. This account's synced data cannot currently distinguish that as the cause either way — verify directly.`,
    `Check inventory/stock levels in Seller/Vendor Central for the product(s) this campaign advertises.`,
    `This campaign had ${String(evidence.impressionsYesterday)} impression(s) yesterday (${String(evidence.yesterdayDate)}) after meeting the serving bar on ${String(evidence.trailingBaselineDaysMeetingBar)} of the prior 7 days — once you find the cause, note it before closing this task.`,
    MARK_EXECUTED,
  ],
};

export function renderInstructions(
  ruleId: string,
  type: TaskType,
  ctx: InstructionContext,
): string[] {
  const key = `${ruleId}:${type}`;
  const template = TEMPLATES[key];
  if (!template) {
    throw new Error(
      `No instruction template registered for (${ruleId}, ${type}) — add one here, not a switch statement.`,
    );
  }
  return template(ctx);
}
