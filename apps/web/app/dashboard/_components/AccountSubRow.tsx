import type { AccountRow } from "../_lib/types";
import type { ViewMode } from "../_lib/types";
import { derive } from "../_lib/derive";
import { tableTokens, marketplaceDisplay } from "../_lib/theme";
import { metricColor } from "../_lib/health";
import { cur, cur2, pct, xfmt, intfmt, EM_DASH } from "../_lib/format";
import { Sparkline } from "./Sparkline";

interface AccountSubRowProps {
  account: AccountRow;
  viewMode: ViewMode;
  showTrends: boolean;
}

export function AccountSubRow({ account, viewMode, showTrends }: AccountSubRowProps) {
  const d = derive(account);
  const mp = marketplaceDisplay[account.marketplace] ?? account.marketplace;

  const cell = `${tableTokens.cellPad} ${tableTokens.numericAlign} text-[11.5px] text-neutral-600`;
  const nullCell = (v: string) =>
    v === EM_DASH ? `${tableTokens.nullText}` : "";

  return (
    <tr className={`${tableTokens.rowBorder} ${tableTokens.subRowBg}`}>
      {/* Indent + marketplace badge */}
      <td className={`${tableTokens.cellPad} min-w-[166px]`}>
        <div className="flex items-center gap-2 pl-7">
          <span className="inline-flex items-center gap-1 rounded bg-neutral-200 px-1.5 py-px text-[10px] font-semibold text-neutral-600">
            <IconFlag className="h-2.5 w-2.5" />
            {mp}
          </span>
          <span className="text-[10.5px] text-neutral-400">{account.currencyCode}</span>
        </div>
      </td>

      {/* Tier + Status — empty on sub-rows */}
      {viewMode === "core" || viewMode === "full" ? (
        <>
          <td className={`${tableTokens.cellPad} w-[84px]`} />
          <td className={`${tableTokens.cellPad} w-[116px]`} />
        </>
      ) : null}

      {/* Revenue */}
      <td className={cell}>
        <span className={nullCell(cur(d.revenue))}>{cur(d.revenue)}</span>
      </td>

      {/* Ad Spend */}
      <td className={cell}>{cur(account.spend)}</td>

      {/* TACoS */}
      <td className={cell}>
        <span className={nullCell(pct(d.tacos))}>{pct(d.tacos)}</span>
      </td>

      {/* ACoS */}
      <td className={`${cell} ${metricColor("acos", d.acos)}`}>{pct(d.acos)}</td>

      {/* ROAS */}
      <td className={`${cell} ${metricColor("roas", d.roas)}`}>{xfmt(d.roas)}</td>

      {/* Organic % */}
      <td className={cell}>
        <span className={nullCell(pct(d.organicPct))}>{pct(d.organicPct)}</span>
      </td>

      {/* CVR */}
      <td className={`${cell} ${metricColor("cvr", d.cvr)}`}>{pct(d.cvr, 2)}</td>

      {/* CPC */}
      <td className={cell}>{cur2(d.cpc)}</td>

      {/* CTR */}
      <td className={`${cell} ${metricColor("ctr", d.ctr)}`}>{pct(d.ctr, 2)}</td>

      {/* Full-mode extra columns */}
      {viewMode === "full" && (
        <>
          <td className={cell}>{cur(account.ppcRev)}</td>
          <td className={cell}>{intfmt(account.ppcOrd)}</td>
          <td className={cell}>
            <span className={nullCell(cur(account.orgRev))}>{cur(account.orgRev)}</span>
          </td>
          <td className={cell}>
            <span className={nullCell(intfmt(account.orgOrd))}>{intfmt(account.orgOrd)}</span>
          </td>
          <td className={cell}>{intfmt(account.clicks)}</td>
          <td className={cell}>{intfmt(account.impr)}</td>
          <td className={cell}>
            <span className={nullCell(intfmt(account.units))}>{intfmt(account.units)}</span>
          </td>
        </>
      )}

      {/* Trends */}
      {showTrends && (
        <td className={`${tableTokens.cellPad} text-center`}>
          <Sparkline data={account.trend} width={56} height={18} />
        </td>
      )}
    </tr>
  );
}

function IconFlag({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 10 10" fill="none" className={className} aria-hidden="true">
      <path d="M1 9V2l4-1 3 1v5l-3-1-4 1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
