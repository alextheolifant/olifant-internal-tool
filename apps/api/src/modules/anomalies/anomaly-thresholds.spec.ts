import {
  ANOMALY_THRESHOLDS,
  evaluateAnomaly,
  isMateriallyWorsened,
} from './anomaly-thresholds';

describe('evaluateAnomaly', () => {
  describe('baseline = 0 (new-activity case)', () => {
    const config = ANOMALY_THRESHOLDS.spend;

    it('flags new activity when actual is meaningfully positive', () => {
      const result = evaluateAnomaly(0, 500, config);
      expect(result).toEqual({
        isAnomaly: true,
        percentChange: null,
        severity: 'watch',
      });
    });

    it('does not flag when both baseline and actual are 0', () => {
      const result = evaluateAnomaly(0, 0, config);
      expect(result).toEqual({
        isAnomaly: false,
        percentChange: null,
        severity: null,
      });
    });

    it('does not flag when actual is 0 or negative', () => {
      expect(evaluateAnomaly(0, -5, config).isAnomaly).toBe(false);
    });
  });

  describe('direction: rise (acos, tacos)', () => {
    const config = ANOMALY_THRESHOLDS.acos; // thresholdPct 30, actNowThresholdPct 60

    it('does not flag below the threshold', () => {
      const result = evaluateAnomaly(20, 25, config); // +25%
      expect(result.isAnomaly).toBe(false);
    });

    it('flags at the threshold as watch', () => {
      const result = evaluateAnomaly(20, 26, config); // +30%
      expect(result.isAnomaly).toBe(true);
      expect(result.severity).toBe('watch');
      expect(result.percentChange).toBeCloseTo(30);
    });

    it('escalates to act_now at the act-now threshold', () => {
      const result = evaluateAnomaly(20, 32, config); // +60%
      expect(result.isAnomaly).toBe(true);
      expect(result.severity).toBe('act_now');
    });

    it('does not flag a drop (wrong direction for rise)', () => {
      const result = evaluateAnomaly(20, 5, config); // -75%
      expect(result.isAnomaly).toBe(false);
    });
  });

  describe('direction: drop (ctr, revenue, clicks)', () => {
    const config = ANOMALY_THRESHOLDS.ctr; // thresholdPct 30, actNowThresholdPct 60

    it('does not flag above the threshold', () => {
      const result = evaluateAnomaly(2.0, 1.6, config); // -20%
      expect(result.isAnomaly).toBe(false);
    });

    it('flags at the threshold', () => {
      const result = evaluateAnomaly(2.0, 1.4, config); // -30%
      expect(result.isAnomaly).toBe(true);
      expect(result.severity).toBe('watch');
    });

    it('escalates to act_now at the act-now threshold', () => {
      const result = evaluateAnomaly(2.0, 0.8, config); // -60%
      expect(result.severity).toBe('act_now');
    });

    it('does not flag a rise (wrong direction for drop)', () => {
      const result = evaluateAnomaly(2.0, 4.0, config); // +100%
      expect(result.isAnomaly).toBe(false);
    });

    it("clicks' near-zero rule is expressed as a 90% drop", () => {
      const clicksConfig = ANOMALY_THRESHOLDS.clicks;
      expect(clicksConfig.direction).toBe('drop');
      expect(clicksConfig.thresholdPct).toBe(90);

      // Actual at 5% of baseline (below the spec's "10% of baseline" bar) → flagged.
      const flagged = evaluateAnomaly(1000, 50, clicksConfig);
      expect(flagged.isAnomaly).toBe(true);

      // Actual at 15% of baseline (above the bar) → not flagged.
      const notFlagged = evaluateAnomaly(1000, 150, clicksConfig);
      expect(notFlagged.isAnomaly).toBe(false);
    });
  });

  describe('direction: drop_or_spike (spend)', () => {
    const config = ANOMALY_THRESHOLDS.spend; // thresholdPct 50, actNowThresholdPct 80

    it('flags a drop past the threshold', () => {
      const result = evaluateAnomaly(1000, 400, config); // -60%
      expect(result.isAnomaly).toBe(true);
    });

    it('flags a spike past the threshold', () => {
      const result = evaluateAnomaly(1000, 1600, config); // +60%
      expect(result.isAnomaly).toBe(true);
    });

    it('does not flag a move that stays within the band', () => {
      const result = evaluateAnomaly(1000, 1200, config); // +20%
      expect(result.isAnomaly).toBe(false);
    });

    it('rates severity by magnitude regardless of direction', () => {
      const bigDrop = evaluateAnomaly(1000, 150, config); // -85%
      const bigSpike = evaluateAnomaly(1000, 1850, config); // +85%
      expect(bigDrop.severity).toBe('act_now');
      expect(bigSpike.severity).toBe('act_now');
    });
  });

  it('handles every configured metric without throwing', () => {
    for (const config of Object.values(ANOMALY_THRESHOLDS)) {
      expect(() => evaluateAnomaly(100, 100, config)).not.toThrow();
    }
  });
});

describe('isMateriallyWorsened', () => {
  it('is false when both are null (still the same new-activity state)', () => {
    expect(isMateriallyWorsened(null, null)).toBe(false);
  });

  it('is true when transitioning between null and a real percentage', () => {
    expect(isMateriallyWorsened(45, null)).toBe(true);
    expect(isMateriallyWorsened(null, 45)).toBe(true);
  });

  it('is false when the change is within the delta', () => {
    expect(isMateriallyWorsened(35, 30, 10)).toBe(false);
  });

  it('is true when the change meets or exceeds the delta', () => {
    expect(isMateriallyWorsened(60, 30, 10)).toBe(true);
    expect(isMateriallyWorsened(40, 30, 10)).toBe(true); // exactly at the delta
  });

  it('compares magnitude, not raw sign (e.g. two drops of different severity)', () => {
    expect(isMateriallyWorsened(-60, -30, 10)).toBe(true);
    expect(isMateriallyWorsened(-35, -30, 10)).toBe(false);
  });

  it('uses the default delta constant when none is passed', () => {
    expect(isMateriallyWorsened(45, 30)).toBe(true); // 15pp > default 10pp
    expect(isMateriallyWorsened(35, 30)).toBe(false); // 5pp < default 10pp
  });
});
