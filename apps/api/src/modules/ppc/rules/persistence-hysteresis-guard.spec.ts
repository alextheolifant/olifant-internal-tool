import { applyPersistenceAndHysteresis } from './persistence-hysteresis-guard';

describe('applyPersistenceAndHysteresis', () => {
  it('D-band fires immediately on first ENTER, no persistence needed', () => {
    const decision = applyPersistenceAndHysteresis({
      band: 'D',
      holdsAtEnter: true,
      holdsAtClear: true,
      prior: null,
    });
    expect(decision.shouldEmit).toBe(true);
    expect(decision.nextState).toEqual({ isActive: true, streakCount: 0 });
  });

  it('D-band does not fire when the condition does not hold at enter', () => {
    const decision = applyPersistenceAndHysteresis({
      band: 'D',
      holdsAtEnter: false,
      holdsAtClear: false,
      prior: null,
    });
    expect(decision.shouldEmit).toBe(false);
    expect(decision.nextState).toEqual({ isActive: false, streakCount: 0 });
  });

  it('W-band requires 2 consecutive ENTER hits before first emission', () => {
    const day1 = applyPersistenceAndHysteresis({
      band: 'W',
      holdsAtEnter: true,
      holdsAtClear: true,
      prior: null,
    });
    expect(day1.shouldEmit).toBe(false);
    expect(day1.nextState).toEqual({ isActive: false, streakCount: 1 });

    const day2 = applyPersistenceAndHysteresis({
      band: 'W',
      holdsAtEnter: true,
      holdsAtClear: true,
      prior: day1.nextState,
    });
    expect(day2.shouldEmit).toBe(true);
    expect(day2.nextState).toEqual({ isActive: true, streakCount: 2 });
  });

  it('W-band streak resets if the condition drops before reaching 2', () => {
    const day1 = applyPersistenceAndHysteresis({
      band: 'W',
      holdsAtEnter: true,
      holdsAtClear: true,
      prior: null,
    });
    expect(day1.nextState.streakCount).toBe(1);

    const day2 = applyPersistenceAndHysteresis({
      band: 'W',
      holdsAtEnter: false,
      holdsAtClear: false,
      prior: day1.nextState,
    });
    expect(day2.shouldEmit).toBe(false);
    expect(day2.nextState).toEqual({ isActive: false, streakCount: 0 });
  });

  it('hysteresis: once active, stays active (and keeps emitting) while above the looser CLEAR bar, even if below ENTER', () => {
    const active: { isActive: boolean; streakCount: number } = {
      isActive: true,
      streakCount: 0,
    };
    const decision = applyPersistenceAndHysteresis({
      band: 'D',
      holdsAtEnter: false, // dropped below enter...
      holdsAtClear: true, // ...but still above the lower clear bar
      prior: active,
    });
    expect(decision.shouldEmit).toBe(true);
    expect(decision.nextState.isActive).toBe(true);
  });

  it('hysteresis: an active entity clears once it drops below the CLEAR bar too', () => {
    const active = { isActive: true, streakCount: 0 };
    const decision = applyPersistenceAndHysteresis({
      band: 'D',
      holdsAtEnter: false,
      holdsAtClear: false,
      prior: active,
    });
    expect(decision.shouldEmit).toBe(false);
    expect(decision.nextState).toEqual({ isActive: false, streakCount: 0 });
  });

  it('an entity hovering exactly at the enter line does not flicker create/expire/recreate', () => {
    // Simulates 4 days: enters, dips just under enter (but still over clear),
    // dips again, then genuinely clears — hysteresis should keep it "active"
    // (still emitting, so the eventual task stays alive) through the dips.
    let state: { isActive: boolean; streakCount: number } | null = null;

    const d1 = applyPersistenceAndHysteresis({
      band: 'D',
      holdsAtEnter: true,
      holdsAtClear: true,
      prior: state,
    });
    state = d1.nextState;
    expect(d1.shouldEmit).toBe(true);

    const d2 = applyPersistenceAndHysteresis({
      band: 'D',
      holdsAtEnter: false,
      holdsAtClear: true,
      prior: state,
    });
    state = d2.nextState;
    expect(d2.shouldEmit).toBe(true); // still active — no flicker

    const d3 = applyPersistenceAndHysteresis({
      band: 'D',
      holdsAtEnter: false,
      holdsAtClear: true,
      prior: state,
    });
    state = d3.nextState;
    expect(d3.shouldEmit).toBe(true); // still active — no flicker

    const d4 = applyPersistenceAndHysteresis({
      band: 'D',
      holdsAtEnter: false,
      holdsAtClear: false,
      prior: state,
    });
    expect(d4.shouldEmit).toBe(false); // genuinely cleared
    expect(d4.nextState.isActive).toBe(false);
  });
});
