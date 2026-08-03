interface StrategyDef {
  tag: string;
  tagClass: string;
  title: string;
  body: string;
  rows: { label: string; value: string }[];
}

const STRATEGIES: StrategyDef[] = [
  {
    tag: "LAUNCH",
    tagClass: "bg-amber-100 text-amber-800",
    title: "Buy rank, time-boxed",
    body:
      "For new products or relaunches. The goal is velocity and visibility, not efficiency — so the engine deliberately tolerates spend that other strategies would flag. Always has an end date; when it expires the product auto-flips to growth, the change is logged in the ledger, and a notification task is created.",
    rows: [
      { label: "Target ACOS default", value: "BE × 1.2 (spending above break-even is allowed, only here)" },
      { label: "Negations (W1)", value: "click threshold loosened ×1.5 — terms get more room to prove" },
      { label: "Bid down (W2)", value: "only vs the launch target; never below the source-proven CPC" },
      { label: "Bid up (W3)", value: "aggressive — fires on 1 order, cap +30%/week" },
      { label: "Harvest (W4)", value: "1 order qualifies" },
      { label: "Budget (W5)", value: "raises up to +100%/week while under launch target" },
      { label: "Extra checks", value: "coverage completeness — auto + broad discovery running, top-of-search presence" },
      { label: "Priority", value: "sales/visibility impact weighted ×1.5" },
      { label: "Target TACOS", value: "optional gate read — blended trend reviewed at phase gates during the launch window" },
    ],
  },
  {
    tag: "GROWTH",
    tagClass: "bg-blue-50 text-blue-700",
    title: "Scale what works",
    body:
      "For products with proven conversion that can absorb more spend at acceptable efficiency. The engine hunts headroom: capped budgets, share gaps, harvest candidates, underinvested placements.",
    rows: [
      { label: "Target ACOS default", value: "BE × 1.0 (grow at break-even, profit comes from scale + organic halo)" },
      { label: "Negations (W1)", value: "standard — 2× expected clicks per order" },
      { label: "Bid down (W2)", value: "enters at 1.5× target" },
      { label: "Bid up (W3)", value: "cap +20%/week" },
      { label: "Harvest (W4)", value: "2 orders, ACOS under BE" },
      { label: "Budget (W5)", value: "standard, cap +50%/week" },
      { label: "Extra checks", value: "underinvested detector — ad spend share far below revenue share raises a scaling idea (I2)" },
      { label: "SQP emphasis", value: "S1 organic winners + S3 share-gap tasks boosted" },
      { label: "Target TACOS", value: "optional guardrail — raises held while blended TACOS runs over it" },
    ],
  },
  {
    tag: "MAINTAIN",
    tagClass: "bg-green-50 text-green-700",
    title: "Hold efficiency (ACOS or TACOS)",
    body:
      "For mature products where the job is defending profit and rank at minimum spend. The engine is strict: waste is cut fastest here, and spend increases need to earn their way in.",
    rows: [
      { label: "Target ACOS default", value: "BE × 0.75, or the explicit value you set per product" },
      { label: "Negations (W1)", value: "tighter — threshold ×0.8" },
      { label: "Bid down (W2)", value: "aggressive — enters at 1.3× target" },
      { label: "Bid up (W3)", value: "conservative — cap +10%/week, only while under target" },
      { label: "Harvest (W4)", value: "2 orders, ACOS under target" },
      { label: "Budget (W5)", value: "raises only if ACOS < 0.9× target, cap +25%/week" },
      { label: "Extra checks", value: "drift alarm — 7d beyond either target for 2 consecutive weeks raises a review task" },
      { label: "SQP emphasis", value: "S2 dependency + protection focus — flags revenue that only exists while ads run" },
      { label: "Priority", value: "waste-elimination impact weighted ×1.5" },
      { label: "Target TACOS", value: "primary hold metric when set — the alarm and the permission layer both read it" },
    ],
  },
];

export function StrategyDefinitionsTab() {
  return (
    <div className="space-y-4">
      <p className="text-[11.5px] text-neutral-400">
        Reference content, not editable here — placeholder wording until the exact copy is finalized elsewhere.
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {STRATEGIES.map((s) => (
          <div key={s.tag} className="rounded-xl border border-neutral-200 bg-surface p-4">
            <span className={`inline-flex rounded px-2 py-0.5 text-[10px] font-bold ${s.tagClass}`}>{s.tag}</span>
            <p className="mt-2 text-[13.5px] font-bold text-ink">{s.title}</p>
            <p className="mt-2 text-[12px] leading-relaxed text-neutral-500">{s.body}</p>
            <dl className="mt-3 space-y-1.5 border-t border-neutral-100 pt-3">
              {s.rows.map((r) => (
                <div key={r.label} className="text-[11.5px] leading-relaxed text-neutral-500">
                  <dt className="inline font-semibold text-ink">{r.label}: </dt>
                  <dd className="inline">{r.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>

      <div className="rounded-xl bg-ink p-5 text-neutral-100">
        <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-brand">
          How the two targets work together
        </p>
        <p className="text-[12.5px] leading-relaxed text-neutral-300">
          Target ACOS is the working number — every bid, negation, and harvest decision on this product&rsquo;s
          keywords resolves to it. Target TACOS never touches keyword math; it is a product-level permission layer
          read from blended (ad + organic) data: while TACOS runs over its target, budget raises and bid-ups on this
          product are downgraded to investigate-tasks — &ldquo;ACOS on target, TACOS over: organic share
          shrinking.&rdquo; Every task states which strategy and target it was judged under, and strategy changes are
          ledger entries.
        </p>
      </div>
    </div>
  );
}
