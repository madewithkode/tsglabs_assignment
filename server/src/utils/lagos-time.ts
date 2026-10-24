/**
 * Lagos time. Every time the agent reads out goes through here, so no raw UTC timestamp ever
 * reaches the model:
 *
 * A "wall clock" Date is an instant shifted so that its UTC fields read as Lagos wall-clock time.
 * That keeps the arithmetic in plain UTC methods, with no runtime time-zone data involved.
 */

/** WAT is UTC+1 with no daylight saving, so a fixed offset is exact. */
const WAT_OFFSET_MS = 60 * 60 * 1000;
export const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/** A Date whose UTC fields read as Lagos wall-clock time. */
export const toWallClock = (instant: Date) => new Date(instant.getTime() + WAT_OFFSET_MS);

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO 8601 in Lagos time, to the minute, e.g. "2026-10-24T14:26:00+01:00". */
export function formatWallClock(wall: Date): string {
  return (
    `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}` +
    `T${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}:00+01:00`
  );
}

/** Ready to read out, e.g. "2:26pm". */
export function wallClockLabel(wall: Date): string {
  const h = wall.getUTCHours();
  const suffix = h < 12 ? 'am' : 'pm';
  return `${h % 12 || 12}:${pad(wall.getUTCMinutes())}${suffix}`;
}

/** ISO weekday: Monday 1 … Sunday 7. */
export const isoWeekday = (wall: Date) => wall.getUTCDay() || 7;

/** Wall-clock midnight of the given wall-clock day, plus `minutes`. */
export const atMinutes = (wall: Date, minutes: number) =>
  new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate()) + minutes * 60_000);

/** The day, ready to read out, e.g. "Monday 26 October". */
export function dayLabel(wall: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })
    .format(wall)
    .replace(',', '');
}

/**
 * An instant as Lagos time, for anything the agent reads out. Raw UTC is never handed to the
 * model.
 */
export function lagosTime(instant: Date | string): { iso: string; label: string } {
  const wall = toWallClock(new Date(instant));
  return { iso: formatWallClock(wall), label: wallClockLabel(wall) };
}
