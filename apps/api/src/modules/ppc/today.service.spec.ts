import { TodayService } from './today.service';
import { DrizzleService } from '../../db/drizzle.service';
import type { RuleDefinition } from './rules/types';
import type { SavingsService } from './monitor/savings.service';

// TodayService imports REGISTERED_RULES directly — mock the registry so this
// test can exercise a synthetic G-band rule without needing a real,
// currently-blocked G1-G4 implementation. This tests the PLUMBING (does a
// G-band candidate get included in the exceptions list, does it get
// correctly excluded from the D-only exceptionsToday count) — it is not a
// claim that any real guard fired on real data.
const fakeDRule: RuleDefinition = {
  id: 'D9',
  band: 'D',
  label: 'Fake D rule',
  describe: () => 'a D-band exception',
  evaluate: async () => [],
};
const fakeGRule: RuleDefinition = {
  id: 'G9',
  band: 'G',
  label: 'Fake G guard',
  describe: () => 'a G-band guard',
  evaluate: async () => [],
};

jest.mock('./rules/rules.registry', () => ({
  get REGISTERED_RULES() {
    return [fakeDRule, fakeGRule];
  },
}));

// getToday now runs two queries in sequence: the task_candidates one (joined
// to clients, feeds exceptions/exceptionsToday) and a separate, unjoined one
// against tasks (feeds the real openTasksCount) — see today.service.ts.
// mockReturnValueOnce twice on `from` gives each call its own shape/result.
function buildDrizzleMock(candidateRows: unknown[], openTasksCount = 0) {
  const candidatesWhere = jest.fn().mockResolvedValue(candidateRows);
  const innerJoin = jest.fn().mockReturnValue({ where: candidatesWhere });
  const tasksWhere = jest.fn().mockResolvedValue([{ openTasksCount }]);
  const from = jest
    .fn()
    .mockReturnValueOnce({ innerJoin })
    .mockReturnValueOnce({ where: tasksWhere });
  const select = jest.fn().mockReturnValue({ from });
  return { db: { select } };
}

// These tests cover the exceptions/stat-card plumbing, not the savings
// counter (that has its own coverage in monitor/) — a stub with no concluded
// monitors keeps verifiedSavings at its "not measured yet" null, which is
// what every assertion below already expects.
function buildSavingsStub() {
  return {
    getSummary: async () => ({
      agencyVerifiedSavingsMonthly: 0,
      byClient: [],
      concludedWithoutSavings: 0,
      noConcludedMonitors: true,
    }),
    getForClient: async () => ({
      verifiedSavingsMonthly: 0,
      noConcludedMonitors: true,
    }),
  } as unknown as SavingsService;
}

describe('TodayService', () => {
  it('includes both D-band and G-band candidates in the exceptions list, with distinct guardColor', async () => {
    const rows = [
      { ruleId: 'D9', clientId: 'c1', clientName: 'Acme', evidence: {} },
      { ruleId: 'G9', clientId: 'c1', clientName: 'Acme', evidence: {} },
    ];
    const drizzle = buildDrizzleMock(rows);
    const service = new TodayService(
      drizzle as unknown as DrizzleService,
      buildSavingsStub(),
    );

    const result = await service.getToday('2026-08-07');

    expect(result.exceptions).toHaveLength(2);
    const dEntry = result.exceptions.find((e) => e.ruleId === 'D9');
    const gEntry = result.exceptions.find((e) => e.ruleId === 'G9');
    expect(dEntry?.guardColor).toBe('act_now');
    expect(gEntry?.guardColor).toBe('watch');
  });

  it('excludes G-band candidates from the exceptionsToday stat (D-band only)', async () => {
    const rows = [
      { ruleId: 'D9', clientId: 'c1', clientName: 'Acme', evidence: {} },
      { ruleId: 'G9', clientId: 'c1', clientName: 'Acme', evidence: {} },
      { ruleId: 'G9', clientId: 'c1', clientName: 'Acme', evidence: {} },
    ];
    const drizzle = buildDrizzleMock(rows);
    const service = new TodayService(
      drizzle as unknown as DrizzleService,
      buildSavingsStub(),
    );

    const result = await service.getToday('2026-08-07');

    expect(result.statCards.exceptionsToday).toBe(1); // only the one D9 row
    expect(result.exceptions).toHaveLength(3); // but all 3 show in the list
  });

  it('ignores candidates for unrecognized or non-D/G-band rules', async () => {
    const rows = [
      {
        ruleId: 'does-not-exist',
        clientId: 'c1',
        clientName: 'Acme',
        evidence: {},
      },
    ];
    const drizzle = buildDrizzleMock(rows, 4);
    const service = new TodayService(
      drizzle as unknown as DrizzleService,
      buildSavingsStub(),
    );

    const result = await service.getToday('2026-08-07');

    expect(result.exceptions).toHaveLength(0);
    expect(result.statCards.exceptionsToday).toBe(0);
    // openTasksCount is a real, separate query against tasks (OPEN_STATUSES)
    // — independent of the task_candidates rows/exceptions-list filtering
    // above, which is exactly what this asserts by giving it a different value.
    expect(result.statCards.openTasksCount).toBe(4);
  });

  it('reports verifiedSavings as null-and-pending (not 0) while no monitor has concluded', async () => {
    const drizzle = buildDrizzleMock([]);
    const service = new TodayService(
      drizzle as unknown as DrizzleService,
      buildSavingsStub(),
    );

    const result = await service.getToday('2026-08-07');

    // The distinction the card renders on: "nothing has finished its 30-day
    // window yet" is not the same claim as "we measured and saved $0".
    expect(result.statCards.verifiedSavings).toBeNull();
    expect(result.statCards.verifiedSavingsPending).toBe(true);
    // dollarsAtStake still needs task-level impact scoring — genuinely unbuilt.
    expect(result.statCards.dollarsAtStake).toBeNull();
  });

  it('reports a real verifiedSavings figure once monitors have concluded', async () => {
    const drizzle = buildDrizzleMock([]);
    const savings = {
      getSummary: async () => ({
        agencyVerifiedSavingsMonthly: 137.5,
        byClient: [],
        concludedWithoutSavings: 2,
        noConcludedMonitors: false,
      }),
      getForClient: async () => ({
        verifiedSavingsMonthly: 137.5,
        noConcludedMonitors: false,
      }),
    } as unknown as SavingsService;
    const service = new TodayService(
      drizzle as unknown as DrizzleService,
      savings,
    );

    const result = await service.getToday('2026-08-07');

    expect(result.statCards.verifiedSavings).toBe(137.5);
    expect(result.statCards.verifiedSavingsPending).toBe(false);
  });
});
