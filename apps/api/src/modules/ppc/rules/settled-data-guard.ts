// ─── Settled-data guard ──────────────────────────────────────────────────────
// Rule windows always end T-2 (enforced by callers, not here). Beyond that,
// Amazon's own click-to-conversion attribution can still land for up to 14
// days after a click — a day's reported ACOS isn't fully final until 14 days
// have passed since that day.
//
// INTERPRETIVE JUDGMENT CALL — flagging this explicitly since the brief
// doesn't give an exact formula: "a material share of clicks still
// restatement-age" cannot mean "any day within 14 days of the evaluation
// date," because every window a daily rule reads (by construction, ending
// T-2) is entirely inside that 14-day span — that reading would make every
// short trailing window (D4's 7d, for instance) permanently unable to pass,
// which can't be the intent of a "daily" rule band.
//
// Implemented interpretation instead: judge the ENTITY's data maturity using
// a broader reference window (its own click history), not the narrow rule
// window in isolation. An entity is "settled enough" once its last-14-day
// click volume is a MINORITY share of that broader reference window — i.e.
// it has enough history outside the restatement period to trust a reading of
// its recent metrics. A brand-new campaign (all its lifetime clicks are
// recent) fails this; a mature campaign (most of its clicks are older than
// 14 days) passes it, even though its own trailing-7d window is, in
// isolation, entirely "recent." Please confirm this matches intent — happy
// to rewire it to a different definition if not.

const RESTATEMENT_WINDOW_DAYS = 14;

export interface DailyClickPoint {
  date: string; // YYYY-MM-DD
  clicks: number;
}

export interface SettledDataResult {
  isSettled: boolean;
  recentClickShare: number; // 0..1
}

function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// referenceWindowClicks should span a lookback meaningfully longer than 14
// days (e.g. 60 days, or since campaign start if shorter) — a reference
// window that's itself only ~14 days deep can never demonstrate maturity.
export function checkSettledData(
  referenceWindowClicks: DailyClickPoint[],
  evaluationDate: string,
  materialShareThreshold = 0.5,
): SettledDataResult {
  const cutoff = addDaysISO(evaluationDate, -RESTATEMENT_WINDOW_DAYS);
  let total = 0;
  let recent = 0;
  for (const { date, clicks } of referenceWindowClicks) {
    total += clicks;
    if (date >= cutoff) recent += clicks;
  }
  if (total === 0) return { isSettled: true, recentClickShare: 0 };
  const recentClickShare = recent / total;
  return { isSettled: recentClickShare < materialShareThreshold, recentClickShare };
}
