export interface DailyMetricRow {
  date: string; // YYYY-MM-DD
  spend: number;
  sales: number;
  clicks: number;
}

export interface CampaignWithDailyMetrics {
  campaignId: string; // Amazon's campaign id — used as the rule's entityId
  campaignName: string | null;
  dailyMetrics: DailyMetricRow[];
}

export interface WindowAggregate {
  spend: number;
  sales: number;
  clicks: number;
  // ACOS as a percentage number (30 = 30%), matching margin/BE/targetAcos
  // everywhere else in this codebase — computed as (spend / sales) * 100
  // over the whole window, NOT an average of daily ACOS ratios (which would
  // be skewed by low-volume days).
  acos: number | null;
}

export function aggregateWindow(rows: DailyMetricRow[], start: string, end: string): WindowAggregate {
  let spend = 0;
  let sales = 0;
  let clicks = 0;
  for (const r of rows) {
    if (r.date >= start && r.date <= end) {
      spend += r.spend;
      sales += r.sales;
      clicks += r.clicks;
    }
  }
  return { spend, sales, clicks, acos: sales > 0 ? (spend / sales) * 100 : null };
}

export function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
