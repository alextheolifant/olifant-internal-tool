import { MonitorRepository } from '../monitor/monitor.repository';
import { DrizzleService } from '../../../db/drizzle.service';
import { QueueService } from './queue.service';
import { TaskRepository, type TaskRow } from './task.repository';

// Row builder — only the fields the queue payload reads.
function taskRow(
  over: Partial<TaskRow> & { id: string },
): TaskRow & { clientName: string } {
  return {
    clientId: 'client-1',
    profile: 'US',
    ruleId: 'D5',
    band: 'D',
    entityType: 'campaign',
    entityId: 'c1',
    type: 'investigate',
    title: 'A task',
    action: {
      entityType: 'campaign',
      campaignId: 'c1',
      campaignName: 'C',
      adGroupId: null,
      oldValue: null,
      newValue: null,
      field: null,
    },
    evidence: {
      metrics: {},
      window: null,
      provenance: { reportJobId: null, syncedAt: null, syncType: null },
      fallbacks: {},
    },
    instructions: [],
    impactMonthlyUsd: null,
    impactBasis: null,
    priorityScore: 10,
    confidence: 'high',
    status: 'pending',
    blockedBy: null,
    requiresReview: false,
    standingDirectivesAck: false,
    assignee: null,
    rollback: 'undo',
    dismissReason: null,
    dismissNote: null,
    actionFingerprint: 'fp',
    confirmedValue: null,
    verifiedAt: null,
    verifyMismatchReason: null,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    executedAt: null,
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    clientName: 'Acme',
    ...over,
  };
}

function buildService(
  rows: (TaskRow & { clientName: string })[],
  total = rows.length,
) {
  const taskRepo = {
    queryQueue: jest.fn().mockResolvedValue({ rows, total }),
  } as unknown as TaskRepository;
  const monitors = {} as unknown as MonitorRepository;
  return new QueueService({} as unknown as DrizzleService, taskRepo, monitors);
}

describe('QueueService.list — impact bar', () => {
  it('expresses each impact as a fraction of the largest in the result set', async () => {
    const svc = buildService([
      taskRow({
        id: 'a',
        impactMonthlyUsd: '400.00',
      }),
      taskRow({
        id: 'b',
        impactMonthlyUsd: '100.00',
      }),
    ]);
    const res = await svc.list({});
    expect(res.rows[0].impactBarFraction).toBe(1);
    expect(res.rows[1].impactBarFraction).toBeCloseTo(0.25, 5);
  });

  it('distinguishes "no impact figure" (null) from "smallest here" (0)', async () => {
    const svc = buildService([
      taskRow({
        id: 'a',
        impactMonthlyUsd: '400.00',
      }),
      taskRow({
        id: 'b',
        impactMonthlyUsd: '0.00',
      }),
      taskRow({ id: 'c', impactMonthlyUsd: null }),
    ]);
    const res = await svc.list({});
    expect(res.rows[1].impactBarFraction).toBe(0);
    expect(res.rows[2].impactBarFraction).toBeNull();
  });

  it('does not divide by zero when nothing in the set has impact', async () => {
    const svc = buildService([
      taskRow({ id: 'a', impactMonthlyUsd: null }),
      taskRow({ id: 'b', impactMonthlyUsd: null }),
    ]);
    const res = await svc.list({});
    expect(res.rows.every((r) => r.impactBarFraction === null)).toBe(true);
  });
});

describe('QueueService.list — blocked tasks', () => {
  // NOTE: nothing in the codebase currently SETS blocked_by — no rule or
  // service populates it — so no real blocked task exists to demo against.
  // This covers the payload contract the Queue table renders
  // ("waits on TSK-…") so it's correct whenever blocking does start being
  // written.
  it('surfaces blocked_by so the sub-line can read "waits on TSK-…"', async () => {
    const svc = buildService([
      taskRow({ id: 'TSK-1', status: 'blocked', blockedBy: 'TSK-0421' }),
    ]);
    const res = await svc.list({});
    expect(res.rows[0].blockedBy).toBe('TSK-0421');
    expect(res.rows[0].status).toBe('blocked');
  });

  it('leaves blocked_by null for tasks that are not blocked', async () => {
    const svc = buildService([taskRow({ id: 'TSK-2' })]);
    const res = await svc.list({});
    expect(res.rows[0].blockedBy).toBeNull();
  });
});

describe('QueueService.list — paging', () => {
  it('reports the filtered total independently of the page, for bulk-approve', async () => {
    const svc = buildService([taskRow({ id: 'a' })], 137);
    const res = await svc.list({ limit: 1, offset: 0 });
    expect(res.rows).toHaveLength(1);
    expect(res.total).toBe(137);
  });

  it('caps an oversized limit rather than accepting it', async () => {
    const svc = buildService([taskRow({ id: 'a' })]);
    const res = await svc.list({ limit: 100000 });
    expect(res.limit).toBeLessThanOrEqual(200);
  });
});

describe('QueueService.list — row shape', () => {
  it('carries the sub-line components the table renders', async () => {
    const svc = buildService([
      taskRow({
        id: 'TSK-9',
        ruleId: 'W1',
        type: 'negation',
        confidence: 'medium',
      }),
    ]);
    const [row] = (await svc.list({})).rows;
    expect(row.id).toBe('TSK-9');
    expect(row.clientName).toBe('Acme');
    expect(row.estMinutes).toBe(4); // W1:negation, from the task layer's own map
    expect(row.confidence).toBe('medium');
    expect(row.ruleId).toBe('W1');
  });
});
