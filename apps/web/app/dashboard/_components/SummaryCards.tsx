import type { Totals } from "../_lib/types";
import { cur, pct, xfmt } from "../_lib/format";
import { metricColor } from "../_lib/health";

interface SummaryCardsProps {
  totals: Totals;
  dateLabel: string;
  isLoading: boolean;
  currencyCode: string;
  approx: boolean;
}

interface CardDef {
  id: string;
  label: string;
  value: (t: Totals, code: string, approx: boolean) => string;
  colorClass: (t: Totals) => string;
}

const CARDS: CardDef[] = [
  {
    id: "revenue",
    label: "Revenue",
    value: (t, c, a) => cur(t.revenue, c, a),
    colorClass: () => "text-ink",
  },
  {
    id: "adSpend",
    label: "Ad Spend",
    value: (t, c, a) => cur(t.spend, c, a),
    colorClass: () => "text-ink",
  },
  {
    id: "tacos",
    label: "Blended TACoS",
    value: (t) => pct(t.tacos),
    colorClass: (t) => metricColor("tacos", t.tacos),
  },
  {
    id: "acos",
    label: "Blended ACoS",
    value: (t) => pct(t.acos),
    colorClass: (t) => metricColor("acos", t.acos),
  },
  {
    id: "roas",
    label: "Blended ROAS",
    value: (t) => xfmt(t.roas),
    colorClass: (t) => metricColor("roas", t.roas),
  },
  {
    id: "organicPct",
    label: "Organic %",
    value: (t) => pct(t.organicPct),
    colorClass: (t) => metricColor("organicPct", t.organicPct),
  },
];

export function SummaryCards({ totals, dateLabel, isLoading, currencyCode, approx }: SummaryCardsProps) {

  return (
    <div className="grid grid-cols-2 gap-3 px-5 py-4 sm:grid-cols-3 xl:grid-cols-6">
      {CARDS.map((card) => {
        const value = card.value(totals, currencyCode, approx);
        const colorCls = card.colorClass(totals);

        return (
          <div
            key={card.id}
            className="flex flex-col gap-1 rounded-xl border border-neutral-200 bg-surface px-4 py-3.5 shadow-sm"
          >
            <p className="text-[10.5px] font-semibold uppercase tracking-wider text-neutral-400">
              {card.label}
            </p>

            {isLoading ? (
              <div className="mt-1 h-7 w-20 animate-pulse rounded-md bg-neutral-200" />
            ) : (
              <p className={`text-[22px] font-bold leading-tight tracking-tight ${colorCls}`}>
                {value}
              </p>
            )}

            <p className="text-[11px] text-neutral-400">{dateLabel}</p>
          </div>
        );
      })}
    </div>
  );
}
