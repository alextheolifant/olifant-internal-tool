import { TodayService } from './today.service';
import { DrizzleService } from '../../db/drizzle.service';
import type { RuleDefinition } from './rules/types';

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

function buildDrizzleMock(rows: unknown[]) {
  const where = jest.fn().mockResolvedValue(rows);
  const innerJoin = jest.fn().mockReturnValue({ where });
  const from = jest.fn().mockReturnValue({ innerJoin });
  const select = jest.fn().mockReturnValue({ from });
  return { db: { select } };
}

describe('TodayService', () => {
  it('includes both D-band and G-band candidates in the exceptions list, with distinct guardColor', async () => {
    const rows = [
      { ruleId: 'D9', clientId: 'c1', clientName: 'Acme', evidence: {} },
      { ruleId: 'G9', clientId: 'c1', clientName: 'Acme', evidence: {} },
    ];
    const drizzle = buildDrizzleMock(rows);
    const service = new TodayService(drizzle as unknown as DrizzleService);

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
    const service = new TodayService(drizzle as unknown as DrizzleService);

    const result = await service.getToday('2026-08-07');

    expect(result.statCards.exceptionsToday).toBe(1); // only the one D9 row
    expect(result.exceptions).toHaveLength(3); // but all 3 show in the list
  });

  it('ignores candidates for unrecognized or non-D/G-band rules', async () => {
    const rows = [{ ruleId: 'does-not-exist', clientId: 'c1', clientName: 'Acme', evidence: {} }];
    const drizzle = buildDrizzleMock(rows);
    const service = new TodayService(drizzle as unknown as DrizzleService);

    const result = await service.getToday('2026-08-07');

    expect(result.exceptions).toHaveLength(0);
    expect(result.statCards.exceptionsToday).toBe(0);
    // openTasksCount is still the raw row count — a stand-in per the API's
    // own documented behavior, unaffected by the exceptions-list filtering.
    expect(result.statCards.openTasksCount).toBe(1);
  });

  it('always returns null (not 0) for the two stat cards that need unbuilt phases', async () => {
    const drizzle = buildDrizzleMock([]);
    const service = new TodayService(drizzle as unknown as DrizzleService);

    const result = await service.getToday('2026-08-07');

    expect(result.statCards.verifiedSavings).toBeNull();
    expect(result.statCards.dollarsAtStake).toBeNull();
  });
});
