import { computeActionFingerprint } from './action-fingerprint';

describe('computeActionFingerprint', () => {
  it('same rule/entity/type/old-value produces the same fingerprint even if numbers shift slightly', () => {
    const a = computeActionFingerprint({
      ruleId: 'D1',
      entityType: 'campaign',
      entityId: 'c1',
      type: 'budget',
      oldValue: 50,
    });
    const b = computeActionFingerprint({
      ruleId: 'D1',
      entityType: 'campaign',
      entityId: 'c1',
      type: 'budget',
      oldValue: 50.2, // rounds to the same bucket as 50
    });
    expect(a).toBe(b);
  });

  it('a materially different starting value (old_value) produces a different fingerprint', () => {
    const a = computeActionFingerprint({
      ruleId: 'D1',
      entityType: 'campaign',
      entityId: 'c1',
      type: 'budget',
      oldValue: 50,
    });
    const b = computeActionFingerprint({
      ruleId: 'D1',
      entityType: 'campaign',
      entityId: 'c1',
      type: 'budget',
      oldValue: 80, // someone already changed the budget between fires
    });
    expect(a).not.toBe(b);
  });

  it('a different entity always produces a different fingerprint', () => {
    const a = computeActionFingerprint({
      ruleId: 'D4',
      entityType: 'campaign',
      entityId: 'c1',
      type: 'investigate',
      oldValue: null,
    });
    const b = computeActionFingerprint({
      ruleId: 'D4',
      entityType: 'campaign',
      entityId: 'c2',
      type: 'investigate',
      oldValue: null,
    });
    expect(a).not.toBe(b);
  });

  it('a different rule on the same entity always produces a different fingerprint', () => {
    const a = computeActionFingerprint({
      ruleId: 'D4',
      entityType: 'campaign',
      entityId: 'c1',
      type: 'investigate',
      oldValue: null,
    });
    const b = computeActionFingerprint({
      ruleId: 'D5',
      entityType: 'campaign',
      entityId: 'c1',
      type: 'investigate',
      oldValue: null,
    });
    expect(a).not.toBe(b);
  });

  it('investigate-type tasks with no old/new value always fingerprint the same for the same entity, regardless of evidence', () => {
    const a = computeActionFingerprint({
      ruleId: 'D4',
      entityType: 'campaign',
      entityId: 'c1',
      type: 'investigate',
      oldValue: null,
    });
    const b = computeActionFingerprint({
      ruleId: 'D4',
      entityType: 'campaign',
      entityId: 'c1',
      type: 'investigate',
      oldValue: null,
    });
    expect(a).toBe(b);
  });
});
