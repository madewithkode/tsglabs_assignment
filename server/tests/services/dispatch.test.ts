import { describe, expect, it } from 'vitest';
import { RIDERS } from '../../src/config';
import { assignRider, pickupWindow } from '../../src/services/dispatch';

// WAT is UTC+1 all year, so 10:00 WAT is 09:00Z.
const wat = (isoLocal: string) => new Date(`${isoLocal}+01:00`);

describe('assignRider', () => {
  it('gives the same rider for the same booking every time', () => {
    expect(assignRider('SWB-Q7K2M9')).toEqual(assignRider('SWB-Q7K2M9'));
  });

  it('only ever assigns riders from the roster', () => {
    for (const ref of ['SWB-AAAAAA', 'SWB-BBBBBB', 'SWB-CCCCCC', 'SWB-Q7K2M9', 'SWB-ZZZZZZ']) {
      expect(RIDERS).toContainEqual(assignRider(ref));
    }
  });

  it('spreads bookings across more than one rider', () => {
    const names = new Set(
      Array.from({ length: 20 }, (_, i) => assignRider(`SWB-REF${i}`).name),
    );
    expect(names.size).toBeGreaterThan(1);
  });
});

describe('pickupWindow', () => {
  it('sends a rider within the hour for a weekday job paid during working hours', () => {
    // Tuesday 21 Oct 2026, 10:00 WAT
    const result = pickupWindow(wat('2026-10-21T10:00:00'));
    expect(result).toMatchObject({ when: 'within_the_hour', sameDay: true });
    expect(result.pickupBy).toBe('2026-10-21T11:00:00+01:00');
  });

  it('holds a job paid before opening until 8:00 the same morning', () => {
    const result = pickupWindow(wat('2026-10-21T06:30:00'));
    expect(result).toMatchObject({ when: 'from_opening_today', sameDay: true });
    expect(result.pickupBy).toBe('2026-10-21T09:00:00+01:00');
  });

  it('moves a job paid after the 17:30 cutoff to the next morning', () => {
    const result = pickupWindow(wat('2026-10-21T17:45:00'));
    expect(result).toMatchObject({ when: 'next_working_morning', sameDay: false });
    expect(result.pickupBy).toBe('2026-10-22T09:00:00+01:00');
  });

  it('still treats a job paid exactly at the cutoff as same-day', () => {
    expect(pickupWindow(wat('2026-10-21T17:30:00')).sameDay).toBe(true);
  });

  it('skips Sunday: a Saturday-evening job is picked up on Monday', () => {
    // Saturday 24 Oct 2026, 18:00 WAT
    const result = pickupWindow(wat('2026-10-24T18:00:00'));
    expect(result.when).toBe('next_working_morning');
    expect(result.pickupBy).toBe('2026-10-26T09:00:00+01:00');
  });

  it('moves a job paid on Sunday to Monday morning', () => {
    const result = pickupWindow(wat('2026-10-25T12:00:00'));
    expect(result.pickupBy).toBe('2026-10-26T09:00:00+01:00');
  });

  it('describes the window in Lagos time for the agent to read out', () => {
    expect(pickupWindow(wat('2026-10-24T18:00:00')).label).toBe('Monday 26 October, 8:00–9:00am');
  });
});
