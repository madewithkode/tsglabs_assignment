import { describe, expect, it } from 'vitest';
import {
  atMinutes,
  dayLabel,
  formatWallClock,
  isoWeekday,
  lagosTime,
  toWallClock,
  wallClockLabel,
} from '../../src/utils/lagos-time';

describe('toWallClock', () => {
  it('shifts an instant by WAT’s fixed +1h so its UTC fields read as Lagos time', () => {
    const wall = toWallClock(new Date('2026-10-24T23:30:00Z'));
    expect([wall.getUTCDate(), wall.getUTCHours(), wall.getUTCMinutes()]).toEqual([25, 0, 30]);
  });
});

describe('formatWallClock', () => {
  it('writes a wall-clock time as ISO 8601 with the +01:00 offset, to the minute', () => {
    expect(formatWallClock(toWallClock(new Date('2026-10-24T13:26:18Z')))).toBe('2026-10-24T14:26:00+01:00');
  });
});

describe('wallClockLabel', () => {
  it.each([
    ['2026-10-24T09:05:00Z', '10:05am'],
    ['2026-10-24T11:00:00Z', '12:00pm'],
    ['2026-10-24T23:00:00Z', '12:00am'],
  ])('reads %s as %s', (instant, label) => {
    expect(wallClockLabel(toWallClock(new Date(instant)))).toBe(label);
  });
});

describe('isoWeekday', () => {
  it('numbers Monday 1 through Sunday 7', () => {
    expect(isoWeekday(toWallClock(new Date('2026-10-26T09:00:00Z')))).toBe(1);
    expect(isoWeekday(toWallClock(new Date('2026-10-25T09:00:00Z')))).toBe(7);
  });
});

describe('atMinutes', () => {
  it('gives a time of day on the same Lagos day', () => {
    const wall = toWallClock(new Date('2026-10-24T15:45:00Z'));
    expect(formatWallClock(atMinutes(wall, 8 * 60))).toBe('2026-10-24T08:00:00+01:00');
  });
});

describe('dayLabel', () => {
  it('names a Lagos day for reading out', () => {
    expect(dayLabel(toWallClock(new Date('2026-10-26T09:00:00Z')))).toBe('Monday 26 October');
  });
});

describe('lagosTime', () => {
  it('turns a UTC instant into Lagos time, so a model cannot misread Z as local time', () => {
    // 13:26Z is 2:26pm in Lagos — read as local, it looked half an hour expired.
    expect(lagosTime('2026-10-24T13:26:18.865Z')).toEqual({ iso: '2026-10-24T14:26:00+01:00', label: '2:26pm' });
  });

  it('accepts a Date as well as an ISO string', () => {
    expect(lagosTime(new Date('2026-10-21T09:30:00Z'))).toEqual({ iso: '2026-10-21T10:30:00+01:00', label: '10:30am' });
  });
});
