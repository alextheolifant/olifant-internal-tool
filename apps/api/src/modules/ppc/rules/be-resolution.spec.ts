import { resolveAccountBE } from './be-resolution';

describe('resolveAccountBE', () => {
  it('always returns {value, isFallback} together, never a bare number', () => {
    expect(resolveAccountBE(30)).toEqual({ value: 30, isFallback: true });
  });

  it('returns isFallback: false when there is no account default to fall back to', () => {
    expect(resolveAccountBE(null)).toEqual({ value: null, isFallback: false });
  });
});
