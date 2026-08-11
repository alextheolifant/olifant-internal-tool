import type { RuleBand } from '../rules/types';
import type { TaskConfidence, TaskType } from './task.types';

// §8.2: priority = (impact_monthly_usd ÷ est_minutes) × confidence_multiplier × client_multiplier

export const CONFIDENCE_MULTIPLIER: Record<TaskConfidence, number> = {
  high: 1.0,
  medium: 0.7,
  provisional: 0.4,
};

// Estimated minutes to execute one task of this (rule, action type) — lives
// alongside the instruction templates in instruction-templates.ts since both
// are properties of the same (rule, type) pair; kept in this file instead
// because priority scoring is the only consumer and instruction-templates.ts
// shouldn't need to know about scoring.
export const EST_MINUTES: Record<string, number> = {
  'D1:budget': 3, // single field edit
  'D4:investigate': 15, // pull two reports, identify the driver, apply a fix
  'D5:investigate': 15, // check status/budget/inventory across two consoles
};

const DEFAULT_EST_MINUTES = 15;

export function estMinutesFor(ruleId: string, type: TaskType): number {
  return EST_MINUTES[`${ruleId}:${type}`] ?? DEFAULT_EST_MINUTES;
}

export function computePriorityScore(input: {
  impactMonthlyUsd: number | null;
  estMinutes: number;
  confidence: TaskConfidence;
  clientMultiplier: number;
}): number {
  const impact = input.impactMonthlyUsd ?? 0;
  const raw =
    (impact / input.estMinutes) * CONFIDENCE_MULTIPLIER[input.confidence] * input.clientMultiplier;
  return Math.round(raw);
}

// D-band exceptions always sort above every other band regardless of score —
// an explicit sort tier, never achieved by inflating the D-band score itself
// (which would corrupt the score's own meaning wherever it's reported/read
// on its own, e.g. for threshold tuning later).
export function sortTierForBand(band: RuleBand): number {
  return band === 'D' ? 0 : 1;
}
