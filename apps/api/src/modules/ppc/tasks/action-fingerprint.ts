import { createHash } from 'crypto';
import type { TaskType } from './task.types';

// ─── Dedup key: action_fingerprint ─────────────────────────────────────────
// The dedup key is (client, rule, action_fingerprint) — this is the
// action_fingerprint half: "what makes an action THE SAME action."
//
// Deliberately keys on WHAT would be done and TO WHAT STARTING STATE, not on
// the numbers that merely justify doing it or the numbers that follow from
// it mechanically:
//
//   - ruleId + entityType + entityId + type: the same rule proposing the
//     same kind of change to the same entity is the same action, full stop.
//
//   - oldValueBucket (rounded to a whole unit): the CURRENT state being
//     acted on. Two fires proposing "raise the budget from $50" are the same
//     action even if the evidence's ACOS moved half a point between them —
//     that's just this rule re-confirming itself, which should update the
//     existing task's evidence, not spawn a new one. But if a human already
//     changed the budget to $80 between fires, the next fire proposes a
//     genuinely different action (raise FROM $80, not $50) — a different
//     starting state means a different fingerprint, correctly creating a new
//     task instead of silently deduping into a now-stale one.
//
//   - newValue is deliberately excluded from the key: for every action type
//     built so far it's a pure function of oldValue plus a fixed formula
//     (e.g. "+25%"), so it carries no independent information — including it
//     would fragment dedup on formula rounding noise for no benefit. For
//     investigate/exception-type tasks (D4, D5 today) there is no old/new
//     value at all — oldValueBucket is "", and the fingerprint reduces to
//     rule+entity+type. That's intentional: those tasks propose one action
//     ("go investigate this"), not a specific field change, so ANY re-fire
//     on the same entity should dedup into the one open investigation,
//     which is exactly this behavior.
export function computeActionFingerprint(input: {
  ruleId: string;
  entityType: string;
  entityId: string;
  type: TaskType;
  oldValue: string | number | null;
}): string {
  const oldValueBucket =
    typeof input.oldValue === 'number'
      ? String(Math.round(input.oldValue))
      : (input.oldValue ?? '');
  const key = [
    input.ruleId,
    input.entityType,
    input.entityId,
    input.type,
    oldValueBucket,
  ].join('|');
  return createHash('sha256').update(key).digest('hex');
}
