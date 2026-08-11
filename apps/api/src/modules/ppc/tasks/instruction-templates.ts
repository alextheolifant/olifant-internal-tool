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

const MARK_EXECUTED = 'Mark this task Executed — the next sync verifies the change automatically.';

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function money(v: number | null): string {
  return v === null ? 'unknown' : v.toFixed(2);
}
function pct(v: unknown, digits = 1): string {
  return typeof v === 'number' ? v.toFixed(digits) : 'unknown';
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

export function renderInstructions(ruleId: string, type: TaskType, ctx: InstructionContext): string[] {
  const key = `${ruleId}:${type}`;
  const template = TEMPLATES[key];
  if (!template) {
    throw new Error(
      `No instruction template registered for (${ruleId}, ${type}) — add one here, not a switch statement.`,
    );
  }
  return template(ctx);
}
