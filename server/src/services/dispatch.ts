/**
 * Mock dispatch: stands in for the dispatcher assigning a rider once a job is paid. Pure and
 * deterministic, so confirming the same booking twice always returns the same rider and window
 * without any stored state — the Paystack transaction is the only record a booking has.
 */

import { HOURS, RIDERS, Rider } from '../config.js';
import {
  atMinutes,
  DAY_MS,
  dayLabel,
  formatWallClock,
  HOUR_MS,
  isoWeekday,
  toWallClock,
  wallClockLabel,
} from '../utils/lagos-time.js';

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

const isWorkingDay = (wall: Date) =>
  (HOURS.workingDays as readonly number[]).includes(isoWeekday(wall));

const openingSlot = (day: Date) => {
  const from = atMinutes(day, HOURS.openMinutes);
  const by = new Date(from.getTime() + HOUR_MS);
  return { by, range: `${wallClockLabel(from).replace(/am|pm/, '')}–${wallClockLabel(by)}` };
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
        pickupBy: formatWallClock(slot.by),
        label: `Today, ${slot.range}`,
      };
    }
    const by = new Date(wall.getTime() + HOUR_MS);
    return {
      when: 'within_the_hour',
      sameDay: true,
      pickupBy: formatWallClock(by),
      label: `Today, by ${wallClockLabel(by)}`,
    };
  }

  let day = new Date(wall.getTime() + DAY_MS);
  while (!isWorkingDay(day)) day = new Date(day.getTime() + DAY_MS);
  const slot = openingSlot(day);

  return {
    when: 'next_working_morning',
    sameDay: false,
    pickupBy: formatWallClock(slot.by),
    label: `${dayLabel(day)}, ${slot.range}`,
  };
}
