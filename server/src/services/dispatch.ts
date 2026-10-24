/**
 * Mock dispatch: stands in for the dispatcher assigning a rider once a job is paid. Pure and
 * deterministic, so confirming the same booking twice always returns the same rider and window
 * without any stored state — the Paystack transaction is the only record a booking has.
 */

import { HOURS, RIDERS, Rider } from '../config.js';

/** WAT is UTC+1 with no daylight saving, so a fixed offset is exact. */
const WAT_OFFSET_MS = 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** FNV-1a: stable across processes and restarts, unlike anything seeded or random. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function assignRider(reference: string): Rider {
  return RIDERS[hash(reference) % RIDERS.length];
}

export interface PickupWindow {
  when: 'within_the_hour' | 'from_opening_today' | 'next_working_morning';
  sameDay: boolean;
  /** Latest pickup time, ISO 8601 in Lagos time. */
  pickupBy: string;
  /** Ready to read out to the customer. */
  label: string;
}

/** A Date whose UTC fields read as Lagos wall-clock time. */
const toWallClock = (instant: Date) => new Date(instant.getTime() + WAT_OFFSET_MS);

const pad = (n: number) => String(n).padStart(2, '0');

function formatWat(wall: Date): string {
  return (
    `${wall.getUTCFullYear()}-${pad(wall.getUTCMonth() + 1)}-${pad(wall.getUTCDate())}` +
    `T${pad(wall.getUTCHours())}:${pad(wall.getUTCMinutes())}:00+01:00`
  );
}

/** ISO weekday: Monday 1 … Sunday 7. */
const isoWeekday = (wall: Date) => wall.getUTCDay() || 7;

const isWorkingDay = (wall: Date) =>
  (HOURS.workingDays as readonly number[]).includes(isoWeekday(wall));

/** Wall-clock midnight of the given wall-clock day, plus `minutes`. */
const atMinutes = (wall: Date, minutes: number) =>
  new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate()) + minutes * 60_000);

function clockLabel(wall: Date): string {
  const h = wall.getUTCHours();
  const suffix = h < 12 ? 'am' : 'pm';
  return `${h % 12 || 12}:${pad(wall.getUTCMinutes())}${suffix}`;
}

const openingSlot = (day: Date) => {
  const from = atMinutes(day, HOURS.openMinutes);
  const by = new Date(from.getTime() + HOUR_MS);
  return { by, range: `${clockLabel(from).replace(/am|pm/, '')}–${clockLabel(by)}` };
};

export function pickupWindow(paidAt: Date): PickupWindow {
  const wall = toWallClock(paidAt);
  const minutesIntoDay = wall.getUTCHours() * 60 + wall.getUTCMinutes();

  if (isWorkingDay(wall) && minutesIntoDay <= HOURS.sameDayCutoffMinutes) {
    if (minutesIntoDay < HOURS.openMinutes) {
      const slot = openingSlot(wall);
      return {
        when: 'from_opening_today',
        sameDay: true,
        pickupBy: formatWat(slot.by),
        label: `Today, ${slot.range}`,
      };
    }
    const by = new Date(wall.getTime() + HOUR_MS);
    return {
      when: 'within_the_hour',
      sameDay: true,
      pickupBy: formatWat(by),
      label: `Today, by ${clockLabel(by)}`,
    };
  }

  let day = new Date(wall.getTime() + DAY_MS);
  while (!isWorkingDay(day)) day = new Date(day.getTime() + DAY_MS);
  const slot = openingSlot(day);
  const dayName = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(day);

  return {
    when: 'next_working_morning',
    sameDay: false,
    pickupBy: formatWat(slot.by),
    label: `${dayName.replace(',', '')}, ${slot.range}`,
  };
}
