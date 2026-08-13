import type { LedgerRepository } from '../ledger/ledger.repository';
import type { CampaignMetricsRepository } from './campaign-metrics.repository';

export type RuleBand = 'D' | 'W' | 'S' | 'M' | 'I' | 'G';

// Resolved once per client per evaluation run and handed to every rule via
// context — today there is only the account-default fallback (see
// be-resolution.ts), so a single client-level value is correct. Once
// per-campaign resolution exists, rules needing it will resolve their own.
export interface ResolvedBE {
  value: number | null;
  isFallback: boolean;
}

export interface RuleEvalContext {
  clientId: string;
  // "T" — the date the runner is evaluating as of. Rules must derive all
  // their windows from this, never from wall-clock time, so runs are
  // replayable (determinism requirement).
  evaluationDate: string;
  resolveThreshold: (key: string, systemDefault: number) => number;
  be: ResolvedBE;
  campaignMetrics: CampaignMetricsRepository;
  // Read access for D3 — an unmatched external change IS a ledger query
  // (source='external' already means "no task attributed it," see
  // ledger.service.ts), not a rule condition computed from metrics like the
  // others here.
  ledger: LedgerRepository;
}

// One entity's condition reading for a given rule/evaluation. The rule
// reports both threshold readings; the runner (not the rule) decides whether
// to actually emit, based on the persistence + hysteresis guards.
export interface RuleConditionResult {
  entityType: string;
  entityId: string;
  holdsAtEnter: boolean;
  holdsAtClear: boolean;
  evidence: Record<string, unknown>;
}

export interface RuleDefinition {
  id: string;
  band: RuleBand;
  // Human-readable name for the Today screen's exception list, e.g. "ACOS blowout".
  label: string;
  // Builds the one-line human-readable description from a fired candidate's
  // own evidence payload — kept on the rule itself (not a separate registry)
  // so it can never drift out of sync with that rule's actual evidence shape.
  describe: (evidence: Record<string, unknown>) => string;
  evaluate: (ctx: RuleEvalContext) => Promise<RuleConditionResult[]>;
}
