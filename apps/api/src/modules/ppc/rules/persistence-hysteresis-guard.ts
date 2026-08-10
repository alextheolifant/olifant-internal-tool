import type { RuleBand } from './types';

// ─── Persistence + hysteresis guard ─────────────────────────────────────────
// Pure decision function — no DB access here, so it's directly unit-testable
// and deterministic. The runner reads/writes rule_condition_state around it.
//
// Persistence: W/S(/M/I/G)-band rules require the ENTER condition to hold on
// 2 consecutive evaluations before the first emission. D-band rules skip this
// and fire immediately.
//
// Hysteresis: once an entity is "active" (has fired and not yet cleared),
// subsequent evaluations check the looser CLEAR threshold instead of ENTER,
// so an entity hovering right at the line doesn't flicker in and out.

export interface PriorConditionState {
  isActive: boolean;
  streakCount: number;
}

export interface GuardInput {
  band: RuleBand;
  holdsAtEnter: boolean;
  holdsAtClear: boolean;
  prior: PriorConditionState | null;
}

export interface GuardDecision {
  shouldEmit: boolean;
  nextState: PriorConditionState;
}

export function applyPersistenceAndHysteresis(input: GuardInput): GuardDecision {
  const prior = input.prior ?? { isActive: false, streakCount: 0 };

  if (prior.isActive) {
    // Already flagged — stay flagged (and keep emitting fresh evidence) as
    // long as it holds at the looser clear bar; drop out entirely once it
    // falls below that.
    if (input.holdsAtClear) {
      return { shouldEmit: true, nextState: { isActive: true, streakCount: 0 } };
    }
    return { shouldEmit: false, nextState: { isActive: false, streakCount: 0 } };
  }

  if (!input.holdsAtEnter) {
    return { shouldEmit: false, nextState: { isActive: false, streakCount: 0 } };
  }

  if (input.band === 'D') {
    return { shouldEmit: true, nextState: { isActive: true, streakCount: 0 } };
  }

  const streakCount = prior.streakCount + 1;
  if (streakCount >= 2) {
    return { shouldEmit: true, nextState: { isActive: true, streakCount } };
  }
  return { shouldEmit: false, nextState: { isActive: false, streakCount } };
}
