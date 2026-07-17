import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq, ne } from 'drizzle-orm';
import { DrizzleService } from '../../db/drizzle.service';
import {
  MetricsService,
  type DailyMetricPoint,
} from '../metrics/metrics.service';
import { AiService } from '../ai/ai.service';
import { anomalies, clients, syncLogs } from '../../db/schema';
import {
  ANOMALY_THRESHOLDS,
  BASELINE_WINDOW_DAYS,
  MIN_BASELINE_SPEND,
  evaluateAnomaly,
  isMateriallyWorsened,
  type AnomalyEvaluation,
  type AnomalyMetric,
} from './anomaly-thresholds';

const METRIC_FIELD: Record<AnomalyMetric, keyof DailyMetricPoint> = {
  acos: 'acos',
  spend: 'spend',
  ctr: 'ctr',
  clicks: 'clicks',
  tacos: 'tacos',
  revenue: 'revenue',
};

const ANOMALY_METRICS = Object.keys(ANOMALY_THRESHOLDS) as AnomalyMetric[];

interface DetectionSummary {
  date: string;
  clientsChecked: number;
  anomaliesCreated: number;
  anomaliesUpdated: number;
  checksSkipped: { insufficientData: number; belowMinimumVolume: number };
}

function subtractDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function formatMetricValue(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(2);
}

@Injectable()
export class AnomaliesService {
  private readonly logger = new Logger(AnomaliesService.name);

  constructor(
    private readonly drizzle: DrizzleService,
    private readonly metricsService: MetricsService,
    private readonly aiService: AiService,
  ) {}

  /**
   * Checks every non-churned client against a trailing baseline for the
   * given date. Manual entrypoint today (see scripts/detect-anomalies.ts) —
   * TODO(temporal): schedule this daily, right after the metrics sync
   * completes, by having a workflow call this same method directly.
   */
  async detectAnomalies(dateToCheck: string): Promise<DetectionSummary> {
    const summary: DetectionSummary = {
      date: dateToCheck,
      clientsChecked: 0,
      anomaliesCreated: 0,
      anomaliesUpdated: 0,
      checksSkipped: { insufficientData: 0, belowMinimumVolume: 0 },
    };

    const activeClients = await this.drizzle.db.query.clients.findMany({
      where: ne(clients.status, 'churned'),
    });

    const from = subtractDays(dateToCheck, BASELINE_WINDOW_DAYS);

    for (const client of activeClients) {
      const dailyMap = await this.metricsService.getDailyMetricsForClient(
        client.id,
        from,
        dateToCheck,
      );
      summary.clientsChecked++;

      const actualPoint = dailyMap.get(dateToCheck);
      if (!actualPoint) continue;

      const baselineDates = [...dailyMap.keys()].filter(
        (d) => d !== dateToCheck,
      );
      const baselineSpend = average(
        baselineDates.map((d) => dailyMap.get(d)!.spend),
      );

      for (const metric of ANOMALY_METRICS) {
        const config = ANOMALY_THRESHOLDS[metric];
        const field = METRIC_FIELD[metric];
        const actualValue = actualPoint[field];

        if (config.requiresSpApi) {
          const baselineHasNull = baselineDates.some(
            (d) => dailyMap.get(d)![field] === null,
          );
          if (actualValue === null || baselineHasNull) {
            this.logger.log(
              `client=${client.id} metric=${metric} date=${dateToCheck}: skipped, insufficient data`,
            );
            summary.checksSkipped.insufficientData++;
            continue;
          }
        }

        if (baselineSpend < MIN_BASELINE_SPEND) {
          this.logger.log(
            `client=${client.id} metric=${metric} date=${dateToCheck}: skipped, below minimum volume (baseline spend $${baselineSpend.toFixed(2)})`,
          );
          summary.checksSkipped.belowMinimumVolume++;
          continue;
        }

        const baselineValues = baselineDates.map(
          (d) => dailyMap.get(d)![field] as number,
        );
        const baseline = average(baselineValues);
        const actual = actualValue as number;

        const evaluation = evaluateAnomaly(baseline, actual, config);
        if (!evaluation.isAnomaly) continue;

        const created = await this.upsertAnomaly(
          client.id,
          client.name,
          metric,
          baseline,
          actual,
          evaluation,
          dateToCheck,
        );
        if (created === 'created') summary.anomaliesCreated++;
        else if (created === 'updated') summary.anomaliesUpdated++;
      }
    }

    await this.writeSyncLog(summary);
    return summary;
  }

  private async upsertAnomaly(
    clientId: string,
    clientName: string,
    metric: AnomalyMetric,
    baseline: number,
    actual: number,
    evaluation: AnomalyEvaluation,
    dateToCheck: string,
  ): Promise<'created' | 'updated' | 'skipped'> {
    const existing = await this.drizzle.db.query.anomalies.findFirst({
      where: and(
        eq(anomalies.clientId, clientId),
        eq(anomalies.metric, metric),
        eq(anomalies.resolved, false),
      ),
    });

    if (existing) {
      const existingPercentChange =
        existing.percentChange !== null ? Number(existing.percentChange) : null;
      if (
        !isMateriallyWorsened(evaluation.percentChange, existingPercentChange)
      ) {
        return 'skipped';
      }
    }

    const explanation = await this.buildExplanation(
      clientName,
      metric,
      baseline,
      actual,
      evaluation,
      dateToCheck,
    );

    const values = {
      baselineValue: baseline.toString(),
      actualValue: actual.toString(),
      percentChange:
        evaluation.percentChange !== null
          ? evaluation.percentChange.toString()
          : null,
      severity: evaluation.severity!,
      explanation,
    };

    if (existing) {
      await this.drizzle.db
        .update(anomalies)
        .set({ ...values, detectedAt: new Date(), updatedAt: new Date() })
        .where(eq(anomalies.id, existing.id));
      return 'updated';
    }

    await this.drizzle.db
      .insert(anomalies)
      .values({ clientId, metric, ...values });
    return 'created';
  }

  private async buildExplanation(
    clientName: string,
    metric: AnomalyMetric,
    baseline: number,
    actual: number,
    evaluation: AnomalyEvaluation,
    dateToCheck: string,
  ): Promise<string> {
    const changeText =
      evaluation.percentChange === null
        ? 'new activity (no prior baseline)'
        : `${evaluation.percentChange > 0 ? '+' : ''}${evaluation.percentChange.toFixed(1)}%`;

    const prompt = `${clientName}'s ${metric} moved from a baseline of ${formatMetricValue(baseline)} to ${formatMetricValue(actual)} (${changeText}) on ${dateToCheck}. In one or two sentences, explain what this likely means for the account and what to check first. Be direct and specific, no fluff.`;

    try {
      return await this.aiService.generateAnomalyExplanation(prompt);
    } catch (err) {
      this.logger.error(
        `Failed to generate explanation for client=${clientName} metric=${metric}`,
        err instanceof Error ? err.stack : err,
      );
      return '';
    }
  }

  private async writeSyncLog(summary: DetectionSummary): Promise<void> {
    // errorMessage doubles as a free-text summary field here (sync_logs has
    // no dedicated metadata column) — this is a success-path summary, not
    // necessarily an error.
    await this.drizzle.db.insert(syncLogs).values({
      syncType: 'anomaly_detection',
      status: 'success',
      recordsSynced: summary.anomaliesCreated + summary.anomaliesUpdated,
      errorMessage: `clients_checked=${summary.clientsChecked} created=${summary.anomaliesCreated} updated=${summary.anomaliesUpdated} skipped_insufficient_data=${summary.checksSkipped.insufficientData} skipped_below_volume=${summary.checksSkipped.belowMinimumVolume}`,
      completedAt: new Date(),
    });
    this.logger.log(
      `detectAnomalies(${summary.date}) complete: checked=${summary.clientsChecked} created=${summary.anomaliesCreated} updated=${summary.anomaliesUpdated} skipped=${JSON.stringify(summary.checksSkipped)}`,
    );
  }

  async listAnomalies(resolved: boolean, clientId?: string) {
    const conditions = [eq(anomalies.resolved, resolved)];
    if (clientId) conditions.push(eq(anomalies.clientId, clientId));

    const rows = await this.drizzle.db.query.anomalies.findMany({
      where: and(...conditions),
      orderBy: (a, { desc }) => [desc(a.detectedAt)],
      with: { client: true },
    });

    return rows.map((r) => ({
      id: r.id,
      clientId: r.clientId,
      clientName: r.client.name,
      metric: r.metric,
      baselineValue: Number(r.baselineValue),
      actualValue: Number(r.actualValue),
      percentChange: r.percentChange !== null ? Number(r.percentChange) : null,
      severity: r.severity,
      explanation: r.explanation,
      detectedAt: r.detectedAt,
      resolved: r.resolved,
      resolvedAt: r.resolvedAt,
    }));
  }

  async resolveAnomaly(id: string): Promise<void> {
    const result = await this.drizzle.db
      .update(anomalies)
      .set({ resolved: true, resolvedAt: new Date(), updatedAt: new Date() })
      .where(eq(anomalies.id, id))
      .returning({ id: anomalies.id });

    if (result.length === 0) throw new NotFoundException('Anomaly not found');
  }
}
