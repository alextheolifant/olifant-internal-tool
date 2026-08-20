import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DrizzleService } from '../../../db/drizzle.service';
import { taskIdCounters } from '../../../db/schema';

@Injectable()
export class TaskIdRepository {
  constructor(private readonly drizzle: DrizzleService) {}

  // Atomically increments (creating if absent) the counter for dateKey and
  // returns the next TSK-YYYY-MM-DD-NNNNN id. The INSERT ... ON CONFLICT DO
  // UPDATE ... RETURNING is a single statement, so two concurrent callers
  // for the same date can never be handed the same number.
  async nextId(dateKey: string): Promise<string> {
    const [row] = await this.drizzle.db
      .insert(taskIdCounters)
      .values({ dateKey, counter: 1 })
      .onConflictDoUpdate({
        target: taskIdCounters.dateKey,
        set: { counter: sql`${taskIdCounters.counter} + 1` },
      })
      .returning({ counter: taskIdCounters.counter });

    const n = String(row.counter).padStart(5, '0');
    return `TSK-${dateKey}-${n}`;
  }
}
