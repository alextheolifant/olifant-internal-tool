"use client";

import type { ClientRow as IClientRow, ViewMode } from "../_lib/types";
import { derive } from "../_lib/derive";
import { deriveHealth, getHealthTokens, metricColor, tacosGoalColor } from "../_lib/health";
import { tableTokens, tierTokens, statusTokens } from "../_lib/theme";
import { cur, pct, xfmt, cur2, EM_DASH, resolveCurrency } from "../_lib/format";
import { useMarketplace } from "../_lib/marketplace-context";
import { Sparkline } from "./Sparkline";
import { AccountSubRow } from "./AccountSubRow";

function clientCurrency(client: IClientRow, marketplace: string) {
  return resolveCurrency(client.accounts.map((a) => a.currencyCode));
}

interface ClientRowProps {
  client: IClientRow;
  isExpanded: boolean;
  onToggle: () => void;
  onEdit: (client: IClientRow) => void;
  viewMode: ViewMode;
  showTrends: boolean;
}

export function ClientRow({ client, isExpanded, onToggle, onEdit, viewMode, showTrends }: ClientRowProps) {
  const { marketplace } = useMarketplace();
  const { code: cc, approx } = clientCurrency(client, marketplace);
  const d = derive(client);
  const health = deriveHealth(d.tacos, client.goalTacos);
  const ht = getHealthTokens(health);
  const tier = tierTokens[client.tier];
  const status = statusTokens[client.status];
  const canExpand = client.accounts.length > 0;

  const numCell = `${tableTokens.cellPad} ${tableTokens.numericAlign} text-[12px]`;

  return (
    <>
      {/* ── Main row ─────────────────────────────────────────── */}
      <tr
        onClick={canExpand ? onToggle : undefined}
        className={`group ${tableTokens.rowBorder} ${tableTokens.rowHover} ${
          isExpanded ? tableTokens.rowExpanded : ""
        } ${canExpand ? "cursor-pointer select-none" : ""}`}
      >
        {/* Client name + expand chevron */}
        <td className={`${tableTokens.cellPad} min-w-[166px]`}>
          <div className="flex items-center gap-2">
            <span className="flex h-4 w-4 shrink-0 items-center justify-center text-neutral-400">
              {canExpand ? (
                <IconChevron
                  className={`h-3 w-3 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                />
              ) : null}
            </span>
            <span className="text-[12.5px] font-semibold text-ink">{client.name}</span>
            {client.accounts.length > 1 && (
              <span className="rounded bg-neutral-100 px-1 py-px text-[9px] font-bold text-neutral-500">
                {client.accounts.length}
              </span>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onEdit(client); }}
              className="ml-auto hidden h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-300 hover:bg-neutral-100 hover:text-neutral-600 group-hover:flex transition-colors"
              aria-label="Edit client"
            >
              <IconPencil className="h-3 w-3" />
            </button>
          </div>
        </td>

        {/* Tier badge */}
        <td className={`${tableTokens.cellPad} w-[84px] text-center`}>
          <span
            className={`inline-flex items-center justify-center rounded px-1.5 py-0.5 text-[10px] font-bold ${tier.bg} ${tier.text}`}
          >
            {tier.label}
          </span>
        </td>

        {/* Status badge */}
        <td className={`${tableTokens.cellPad} w-[116px]`}>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-semibold ${status.bg} ${status.text}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${status.dot}`} />
            {status.label}
          </span>
        </td>

        {/* Revenue — with goal indicator */}
        <td className={numCell}>
          {d.revenue !== null ? (
            <div className="flex flex-col items-end">
              <span className={tableTokens.inkText}>{cur(d.revenue, cc, approx)}</span>
              {client.goalRevenue !== null && (
                <span className="text-[9.5px] text-neutral-400">
                  Goal {cur(client.goalRevenue, cc)}&nbsp;
                  {d.revenue >= client.goalRevenue ? (
                    <span className="text-green-700">&#x2713;</span>
                  ) : (
                    <span className="text-amber-700">
                      {Math.round((d.revenue / client.goalRevenue) * 100)}%
                    </span>
                  )}
                </span>
              )}
            </div>
          ) : (
            <span className={tableTokens.nullText}>{EM_DASH}</span>
          )}
        </td>

        {/* Ad Spend */}
        <td className={`${numCell} ${tableTokens.inkText}`}>{cur(client.spend, cc, approx)}</td>

        {/* TACoS — with goal indicator */}
        <td className={`${numCell} min-w-[100px]`}>
          {d.tacos !== null ? (
            <div className="flex flex-col items-end">
              <span className={ht.text}>{pct(d.tacos)}</span>
              {client.goalTacos !== null && (
                <span className={`text-[9.5px] ${tacosGoalColor(d.tacos, client.goalTacos)}`}>
                  Goal ≤{pct(client.goalTacos)}&nbsp;
                  {d.tacos <= client.goalTacos ? "✓" : "↑"}
                </span>
              )}
            </div>
          ) : (
            <span className={tableTokens.nullText}>{EM_DASH}</span>
          )}
        </td>

        {/* ACoS */}
        <td className={`${numCell} ${metricColor("acos", d.acos)}`}>{pct(d.acos)}</td>

        {/* ROAS */}
        <td className={`${numCell} ${metricColor("roas", d.roas)}`}>{xfmt(d.roas)}</td>

        {/* Organic % */}
        <td className={numCell}>
          {d.organicPct !== null ? (
            <span className={metricColor("organicPct", d.organicPct)}>{pct(d.organicPct)}</span>
          ) : (
            <span className={tableTokens.nullText}>{EM_DASH}</span>
          )}
        </td>

        {/* CVR */}
        <td className={`${numCell} ${metricColor("cvr", d.cvr)}`}>{pct(d.cvr, 2)}</td>

        {/* CPC */}
        <td className={numCell}>{cur2(d.cpc, cc, approx)}</td>

        {/* CTR */}
        <td className={`${numCell} ${metricColor("ctr", d.ctr)}`}>{pct(d.ctr, 2)}</td>

        {/* Full-mode extra input columns */}
        {viewMode === "full" && (
          <>
            <td className={`${numCell} ${tableTokens.inkText}`}>{cur(client.ppcRev, cc, approx)}</td>
            <td className={`${numCell} ${tableTokens.inkText}`}>{String(client.ppcOrd)}</td>
            <td className={numCell}>
              {client.orgRev !== null ? (
                <span className={tableTokens.inkText}>{cur(client.orgRev, cc, approx)}</span>
              ) : (
                <span className={tableTokens.nullText}>{EM_DASH}</span>
              )}
            </td>
            <td className={numCell}>
              {client.orgOrd !== null ? (
                <span className={tableTokens.inkText}>{String(client.orgOrd)}</span>
              ) : (
                <span className={tableTokens.nullText}>{EM_DASH}</span>
              )}
            </td>
            <td className={`${numCell} ${tableTokens.inkText}`}>{String(client.clicks)}</td>
            <td className={`${numCell} ${tableTokens.inkText}`}>{String(client.impr)}</td>
            <td className={numCell}>
              {client.units !== null ? (
                <span className={tableTokens.inkText}>{String(client.units)}</span>
              ) : (
                <span className={tableTokens.nullText}>{EM_DASH}</span>
              )}
            </td>
          </>
        )}

        {/* Trends sparkline */}
        {showTrends && (
          <td className={`${tableTokens.cellPad} text-center`}>
            <Sparkline data={client.trend} health={health} />
          </td>
        )}
      </tr>

      {/* ── Expanded marketplace sub-rows ──────────────────── */}
      {isExpanded &&
        client.accounts.map((acct) => (
          <AccountSubRow
            key={acct.profileId}
            account={acct}
            viewMode={viewMode}
            showTrends={showTrends}
          />
        ))}
    </>
  );
}

function IconPencil({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" fill="none" className={className} aria-hidden="true">
      <path
        d="M8.5 1.5l2 2L3 11H1v-2L8.5 1.5z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconChevron({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 12 12" fill="none" className={className} aria-hidden="true">
      <path
        d="M4 2l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
