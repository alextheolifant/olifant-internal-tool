import {
  assertValidTransition,
  InvalidTaskTransitionError,
  isTerminal,
  isValidTransition,
} from './task-lifecycle';

describe('task status state machine', () => {
  it('allows the full happy path: pending -> approved -> executed -> verified', () => {
    expect(isValidTransition('pending', 'approved')).toBe(true);
    expect(isValidTransition('approved', 'executed')).toBe(true);
    expect(isValidTransition('executed', 'verified')).toBe(true);
  });

  it('rejects skipping approved: pending straight to executed', () => {
    expect(isValidTransition('pending', 'executed')).toBe(false);
    expect(() => assertValidTransition('pending', 'executed')).toThrow(
      InvalidTaskTransitionError,
    );
  });

  it('allows dismissed/expired/blocked from pending and approved', () => {
    expect(isValidTransition('pending', 'blocked')).toBe(true);
    expect(isValidTransition('pending', 'dismissed')).toBe(true);
    expect(isValidTransition('pending', 'expired')).toBe(true);
    expect(isValidTransition('approved', 'blocked')).toBe(true);
    expect(isValidTransition('approved', 'dismissed')).toBe(true);
    expect(isValidTransition('approved', 'expired')).toBe(true);
  });

  it('allows a blocked task to return to pending or approved once unblocked', () => {
    expect(isValidTransition('blocked', 'pending')).toBe(true);
    expect(isValidTransition('blocked', 'approved')).toBe(true);
  });

  it('rejects any transition out of a terminal status', () => {
    // executed is NOT terminal — verified is its one legal exit.
    expect(isTerminal('executed')).toBe(false);
    for (const terminal of ['verified', 'dismissed', 'expired'] as const) {
      expect(isTerminal(terminal)).toBe(true);
    }
    expect(isValidTransition('verified', 'pending')).toBe(false);
    expect(isValidTransition('dismissed', 'pending')).toBe(false);
    expect(isValidTransition('expired', 'pending')).toBe(false);
    // executed's one legal exit is verified — everything else is rejected
    expect(isValidTransition('executed', 'pending')).toBe(false);
    expect(isValidTransition('executed', 'dismissed')).toBe(false);
  });

  it('rejects a no-op self-transition', () => {
    expect(isValidTransition('pending', 'pending')).toBe(false);
  });

  it('throws with both statuses in the message', () => {
    try {
      assertValidTransition('verified', 'approved');
      fail('expected to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidTaskTransitionError);
      expect((err as Error).message).toContain('verified');
      expect((err as Error).message).toContain('approved');
    }
  });
});
