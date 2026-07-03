import type { Totals, ViewMode } from "../_lib/types";
import { tableTokens } from "../_lib/theme";
import { cur, cur2, pct, xfmt, intfmt, EM_DASH } from "../_lib/format";

interface TotalsRowProps {
  totals: Totals;
  viewMode: ViewMode;
  showTrends: boolean;
  currencyCode: string;
  approx: boolean;
}

export function TotalsRow({ totals, viewMode, showTrends, currencyCode, approx }: TotalsRowProps) {
  const cell = `${tableTokens.cellPad} ${tableTokens.numericAlign} ${tableTokens.totalsText} text-[12px]`;
  const nullCell = `${cell} font-normal ${tableTokens.nullText}`;

  return (
    <tr className={tableTokens.totalsRowBg}>
      {/* Label */}
      <td className={`${tableTokens.cellPad} min-w-[166px]`}>
        <span className="pl-6 text-[12px] font-bold text-ink">Portfolio total</span>
      </td>

      {/* Tier — empty */}
      <td className={`${tableTokens.cellPad} w-[84px]`} />

      {/* Active count */}
      <td className={`${tableTokens.cellPad} w-[116px]`}>
        <span className="text-[11px] font-semibold text-neutral-600">
          {totals.activeCount}/{totals.totalCount} active
        </span>
      </td>

      {/* Revenue */}
      <td className={totals.revenue !== null ? cell : nullCell}>
        {totals.revenue !== null ? cur(totals.revenue, currencyCode, approx) : EM_DASH}
      </td>

      {/* Ad Spend */}
      <td className={cell}>{cur(totals.spend, currencyCode, approx)}</td>

      {/* TACoS */}
      <td className={totals.tacos !== null ? cell : nullCell}>
        {totals.tacos !== null ? pct(totals.tacos) : EM_DASH}
      </td>

      {/* ACoS */}
      <td className={cell}>{pct(totals.acos)}</td>

      {/* ROAS */}
      <td className={cell}>{xfmt(totals.roas)}</td>

      {/* Organic % */}
      <td className={nullCell}>{EM_DASH}</td>

      {/* CVR */}
      <td className={cell}>{pct(totals.cvr, 2)}</td>

      {/* CPC */}
      <td className={cell}>{cur2(totals.cpc, currencyCode, approx)}</td>

      {/* CTR */}
      <td className={cell}>{pct(totals.ctr, 2)}</td>

      {/* Full-mode extras */}
      {viewMode === "full" && (
        <>
          <td className={cell}>{cur(totals.ppcRev, currencyCode, approx)}</td>
          <td className={cell}>{intfmt(totals.ppcOrd)}</td>
          <td className={totals.orgRev !== null ? cell : nullCell}>
            {totals.orgRev !== null ? cur(totals.orgRev, currencyCode, approx) : EM_DASH}
          </td>
          <td className={totals.orgOrd !== null ? cell : nullCell}>
            {totals.orgOrd !== null ? intfmt(totals.orgOrd) : EM_DASH}
          </td>
          <td className={cell}>{intfmt(totals.clicks)}</td>
          <td className={cell}>{intfmt(totals.impr)}</td>
          <td className={totals.units !== null ? cell : nullCell}>
            {totals.units !== null ? intfmt(totals.units) : EM_DASH}
          </td>
        </>
      )}

      {/* Trends — empty in totals */}
      {showTrends && <td className={tableTokens.cellPad} />}
    </tr>
  );
}
