/**
 * Distance pricing. Pure: no I/O, so every rule here is unit-tested directly.
 *
 *     total = max(minimumFee, ceil(baseFee + perKm × roadKm, roundTo))
 *
 * Every refusal returns a reason rather than a price. There is no fallback figure: the
 * alternative to an accurate number is a human dispatcher, never a guess, because whatever comes
 * back here is charged to a real customer.
 */

import { Coordinates, RATE_CARD, RateCard, SAME_PLACE_METERS } from '../config.js';

const EARTH_RADIUS_METERS = 6_371_000;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

export function haversineMeters(a: Coordinates, b: Coordinates): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.latitude)) * Math.cos(toRadians(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export type StraightLineScreen =
  | { ok: true }
  | { ok: false; reason: 'same_place' }
  /** `atLeastKm` is a lower bound: the road can only be longer. */
  | { ok: false; reason: 'out_of_range'; atLeastKm: number };

/**
 * Runs before the road lookup. Road distance is never shorter than the straight line, so a pair
 * already past the limit as the crow flies cannot come back inside it by road — refusing here
 * skips a billable Routes call on exactly the case that matters most, an address matched in the
 * wrong place. This never prices anything; it only refuses.
 */
export function screenStraightLine(
  pickup: Coordinates,
  dropoff: Coordinates,
  card: RateCard = RATE_CARD,
): StraightLineScreen {
  const meters = haversineMeters(pickup, dropoff);
  if (meters < SAME_PLACE_METERS) return { ok: false, reason: 'same_place' };

  const km = round2(meters / 1000);
  if (km > card.maxRoadKm) return { ok: false, reason: 'out_of_range', atLeastKm: km };

  return { ok: true };
}

export interface PriceBreakdown {
  baseFee: number;
  perKm: number;
  /** Naira for the distance alone, rounded to the nearest naira for display. */
  distanceCharge: number;
  /** True when the short-hop floor, not the formula, set the total. */
  minimumApplied: boolean;
}

export type RoadPrice =
  | { ok: true; roadKm: number; breakdown: PriceBreakdown; total: number }
  | { ok: false; reason: 'out_of_range'; roadKm: number };

export function priceRoadDistance(roadMeters: number, card: RateCard = RATE_CARD): RoadPrice {
  const exactKm = roadMeters / 1000;
  const roadKm = round2(exactKm);
  if (exactKm > card.maxRoadKm) return { ok: false, reason: 'out_of_range', roadKm };

  const exactDistanceCharge = card.perKm * exactKm;
  const formula = Math.ceil((card.baseFee + exactDistanceCharge) / card.roundTo) * card.roundTo;
  const minimumApplied = formula < card.minimumFee;

  return {
    ok: true,
    roadKm,
    breakdown: {
      baseFee: card.baseFee,
      perKm: card.perKm,
      distanceCharge: Math.round(exactDistanceCharge),
      minimumApplied,
    },
    total: minimumApplied ? card.minimumFee : formula,
  };
}
