import { d1OutOfBudgetProfitableRule } from './d1-out-of-budget-profitable.rule';
import { d3UnintendedPauseRule } from './d3-unintended-pause.rule';
import { d4AcosBlowoutRule } from './d4-acos-blowout.rule';
import { d5DeliveryStoppedRule } from './d5-delivery-stopped.rule';
import { w1ZeroSaleNegationRule } from './w1-zero-sale-negation.rule';
import type { RuleDefinition } from './types';

// Adding a new rule is just pushing it here — nothing else in the runner
// needs to change.
//
// Explicitly NOT registered, blocked pending data that doesn't exist yet:
// - D2 (spend spike, zero sales): needs target-level spend/orders — only
//   campaign-level is synced.
// - D6 (CVR collapse): needs ASIN-level sessions/unit-session-rate from the
//   SP-API Sales & Traffic report. Confirmed the Go sync's parser
//   (services/sync-sp-api/internal/amazon/sales.go) only defines/reads
//   salesAndTrafficByDate — there's no struct field for
//   salesAndTrafficByAsin at all, and sp_sales_daily has no asin/sessions/
//   unit_session_rate columns. Narrower gap than D2's (same report is
//   already being fetched, the by-ASIN section just isn't parsed or
//   stored) but still not built — do not approximate with account-level
//   aggregates.
// - G1-G4: blocked on SP-API inventory for most clients.
export const REGISTERED_RULES: RuleDefinition[] = [
  d1OutOfBudgetProfitableRule,
  d3UnintendedPauseRule,
  d4AcosBlowoutRule,
  d5DeliveryStoppedRule,
  w1ZeroSaleNegationRule,
];
