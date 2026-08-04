import { d1OutOfBudgetProfitableRule } from './d1-out-of-budget-profitable.rule';
import { d4AcosBlowoutRule } from './d4-acos-blowout.rule';
import type { RuleDefinition } from './types';

// Adding a new rule is just pushing it here — nothing else in the runner
// needs to change. D2/D3/D5/D6 and any G-rule are explicitly out of scope
// for this slice; D3 in particular is blocked (needs entity state history +
// task-log cross-reference, neither of which exists yet).
export const REGISTERED_RULES: RuleDefinition[] = [
  d1OutOfBudgetProfitableRule,
  d4AcosBlowoutRule,
];
