import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, isNotNull, notInArray } from 'drizzle-orm';
import { DrizzleService } from '../../../db/drizzle.service';
import { clients, taskMonitors, tasks } from '../../../db/schema';
import type { MonitorVerdict } from './monitor.types';

export type TaskMonitorRow = typeof taskMonitors.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;

export interface NewMonitorInput {
  taskId: string;
  entityType: string;
  entityId: string;
  campaignId: string;
  executionDate: string;
}

@Injectable()
export class MonitorRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  /**
   * Inserts a monitor, or does nothing if one already exists for this task.
   * Relies on uq_task_monitor_task so repeated daily runs are idempotent
   * without a read-then-write race.
   */
  async openIfAbsent(input: NewMonitorInput): Promise<TaskMonitorRow | null> {
    const [row] = await this.drizzle.db
      .insert(taskMonitors)
      .values(input)
      .onConflictDoNothing({ target: taskMonitors.taskId })
      .returning();
    return row ?? null;
  }

  /**
   * Tasks that have reached a terminal post-execution state but have no
   * monitor yet. Includes verify_failed deliberately: the change may still
   * have altered spend (someone entered a different value), and that effect
   * is exactly as worth measuring as an intended one.
   */
  async findExecutedTasksWithoutMonitor(): Promise<TaskRow[]> {
    const monitored = await this.drizzle.db.select({ taskId: taskMonitors.taskId }).from(taskMonitors);
    const monitoredIds = monitored.map((m) => m.taskId);
    return this.drizzle.db.query.tasks.findMany({
      where: and(
        inArray(tasks.status, ['executed', 'verified', 'verify_failed']),
        isNotNull(tasks.executedAt),
        // notInArray on an empty list produces a false predicate in SQL, so
        // the first-ever run (no monitors yet) has to skip the clause.
        monitoredIds.length > 0 ? notInArray(tasks.id, monitoredIds) : undefined,
      ),
    });
  }

  async findWatching(): Promise<TaskMonitorRow[]> {
    return this.drizzle.db.query.taskMonitors.findMany({
      where: eq(taskMonitors.state, 'watching'),
      orderBy: desc(taskMonitors.executionDate),
    });
  }

  async findByTaskId(taskId: string): Promise<TaskMonitorRow | undefined> {
    return this.drizzle.db.query.taskMonitors.findFirst({ where: eq(taskMonitors.taskId, taskId) });
  }

  async findById(id: string): Promise<TaskMonitorRow | undefined> {
    return this.drizzle.db.query.taskMonitors.findFirst({ where: eq(taskMonitors.id, id) });
  }

  async saveCheckpoint(id: string, verdict: MonitorVerdict): Promise<void> {
    await this.drizzle.db
      .update(taskMonitors)
      .set({ checkpoint14d: verdict, updatedAt: new Date() })
      .where(eq(taskMonitors.id, id));
  }

  /** Writing the +30d verdict is what concludes a monitor. */
  async conclude(id: string, verdict: MonitorVerdict): Promise<void> {
    await this.drizzle.db
      .update(taskMonitors)
      .set({ verdict30d: verdict, state: 'concluded', updatedAt: new Date() })
      .where(eq(taskMonitors.id, id));
  }

  async getTask(taskId: string): Promise<TaskRow | undefined> {
    return this.drizzle.db.query.tasks.findFirst({ where: eq(tasks.id, taskId) });
  }

  /**
   * Every concluded monitor's verdict alongside its client, for the savings
   * aggregation. Only concluded monitors count — a mid-flight checkpoint is
   * explicitly provisional and must not be banked as a verified number.
   */
  async listConcludedForSavings(): Promise<
    { clientId: string; clientName: string; taskId: string; verdict: MonitorVerdict }[]
  > {
    const rows = await this.drizzle.db
      .select({
        clientId: tasks.clientId,
        clientName: clients.name,
        taskId: taskMonitors.taskId,
        verdict: taskMonitors.verdict30d,
      })
      .from(taskMonitors)
      .innerJoin(tasks, eq(tasks.id, taskMonitors.taskId))
      .innerJoin(clients, eq(clients.id, tasks.clientId))
      .where(eq(taskMonitors.state, 'concluded'));

    return rows
      .filter((r) => r.verdict !== null)
      .map((r) => ({ ...r, verdict: r.verdict as MonitorVerdict }));
  }

  async listAll(): Promise<TaskMonitorRow[]> {
    return this.drizzle.db.query.taskMonitors.findMany({ orderBy: desc(taskMonitors.createdAt) });
  }
}
