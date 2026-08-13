import { renderInstructions } from './instruction-templates';
import type { TaskAction } from './task.types';

const baseAction: TaskAction = {
  entityType: 'campaign',
  campaignId: 'c1',
  campaignName: "SP | CD | Auto | All",
  adGroupId: null,
  oldValue: null,
  newValue: null,
  field: null,
};

describe('renderInstructions', () => {
  it('D1:budget embeds the verbatim campaign name and exact dollar values, ends with Mark Executed', () => {
    const steps = renderInstructions('D1', 'budget', {
      action: { ...baseAction, oldValue: 50, newValue: 62.5 },
      evidence: {},
    });
    expect(steps[0]).toContain("SP | CD | Auto | All");
    expect(steps.join(' ')).toContain('$50.00');
    expect(steps.join(' ')).toContain('$62.50');
    expect(steps[steps.length - 1]).toBe(
      'Mark this task Executed — the next sync verifies the change automatically.',
    );
  });

  it('D4:investigate embeds the real evidence numbers directly — nothing says "see evidence above"', () => {
    const steps = renderInstructions('D4', 'investigate', {
      action: baseAction,
      evidence: {
        windowStart: '2026-07-25',
        windowEnd: '2026-08-01',
        trailing7dSpend: 700,
        trailing7dSales: 1000,
        trailing7dAcos: 70,
        be: 30,
        multiplier: 2,
      },
    });
    const text = steps.join(' ');
    expect(text).toContain('2026-07-25');
    expect(text).toContain('2026-08-01');
    expect(text).toContain('$700.00');
    expect(text).toContain('$1000.00');
    expect(text).toContain('70.0%');
    expect(text).toContain('30.0%');
    expect(text.toLowerCase()).not.toContain('see evidence');
    expect(text.toLowerCase()).not.toContain('see above');
  });

  it('D5:investigate states plainly what is and is not known, embeds the real numbers', () => {
    const steps = renderInstructions('D5', 'investigate', {
      action: baseAction,
      evidence: {
        yesterdayDate: '2026-08-02',
        impressionsYesterday: 0,
        trailingBaselineDaysMeetingBar: 6,
      },
    });
    const text = steps.join(' ');
    expect(text).toContain('2026-08-02');
    expect(text).toContain('0 impression');
    expect(text).toContain('6');
  });

  it('throws for an (rule, type) pair with no registered template', () => {
    expect(() => renderInstructions('D4', 'budget', { action: baseAction, evidence: {} })).toThrow(
      /No instruction template registered/,
    );
  });
});
