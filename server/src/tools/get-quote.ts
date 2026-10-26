/**
 * get_quote: two resolved address ids → a locked price.
 *
 * The quote is stored server-side and only its id goes back to the agent. create_payment charges
 * the stored total, so the amount a customer pays can only be the amount this tool computed —
 * not a figure the model mis-copied, rounded, or was talked into ("make it ₦3,000 abeg").
 */

import { RATE_CARD, QUOTE_TTL_MINUTES } from '../config.js';
import { pickupWindow, PickupWindow } from '../services/dispatch.js';
import { priceRoadDistance, screenStraightLine } from '../services/pricing.js';
import { roadDistanceMeters } from '../services/routes.js';
import { lagosTime } from '../utils/lagos-time.js';
import { HAND_OFF, QUOTE_TTL_MS, ToolContext } from './context.js';

const RE_RESOLVE =
  'That address has expired or was never resolved. Run resolve_address again for it, then quote again.';

export type GetQuoteResult =
  | {
      status: 'ok';
      quote_id: string;
      pickup: { name: string; address: string };
      dropoff: { name: string; address: string };
      road_km: number;
      price: { base_fee: number; per_km: number; distance_charge: number; minimum_applied: boolean };
      total_naira: number;
      /** Lagos time. */
      expires_at: string;
      /** Ready to read out, e.g. "2:26pm". */
      expires_at_label: string;
      valid_for_minutes: number;
      /** When a rider would come if the customer paid right now, so they know before paying. */
      pickup_if_paid_now: { when: PickupWindow['when']; label: string };
      next_step: string;
    }
  | { status: 'unknown_address_id'; which: 'pickup' | 'dropoff'; next_step: string }
  | { status: 'same_place'; next_step: string }
  | { status: 'out_of_range'; road_km: number; at_least: boolean; max_km: number; next_step: string }
  | { status: 'provider_error'; detail: string; next_step: string };

const outOfRange = (roadKm: number, atLeast: boolean): GetQuoteResult => ({
  status: 'out_of_range',
  road_km: roadKm,
  at_least: atLeast,
  max_km: RATE_CARD.maxRoadKm,
  next_step: `Tell the customer this trip is ${atLeast ? 'at least ' : ''}${roadKm}km by road, beyond the ${RATE_CARD.maxRoadKm}km our bikes cover, so we can't take it. Do not offer a price.`,
});

export async function getQuote(
  input: { pickup_address_id: string; dropoff_address_id: string; item_description: string },
  ctx: ToolContext,
): Promise<GetQuoteResult> {
  const pickup = ctx.addresses.get(input.pickup_address_id);
  if (!pickup) return { status: 'unknown_address_id', which: 'pickup', next_step: RE_RESOLVE };
  const dropoff = ctx.addresses.get(input.dropoff_address_id);
  if (!dropoff) return { status: 'unknown_address_id', which: 'dropoff', next_step: RE_RESOLVE };

  const screen = screenStraightLine(pickup.location, dropoff.location);
  if (!screen.ok && screen.reason === 'same_place') {
    return {
      status: 'same_place',
      next_step:
        'Pickup and drop-off resolved to the same spot. Read both back to the customer and ask for the exact street or landmark of each, then resolve them again.',
    };
  }
  if (!screen.ok && screen.reason === 'out_of_range') return outOfRange(screen.atLeastKm, true);

  const road = await roadDistanceMeters(pickup.location, dropoff.location);
  if (!road.ok) return { status: 'provider_error', detail: road.detail, next_step: HAND_OFF };

  const price = priceRoadDistance(road.meters);
  if (!price.ok) return outOfRange(price.roadKm, false);

  const expiresAt = new Date(ctx.now().getTime() + QUOTE_TTL_MS).toISOString();
  const quoteId = ctx.quotes.put({
    pickup,
    dropoff,
    item: input.item_description,
    roadKm: price.roadKm,
    breakdown: price.breakdown,
    totalNaira: price.total,
    expiresAt,
  });

  // Said before payment, not after: a customer paid at 11pm on a Saturday and only then learned
  // the rider would come on Monday.
  const pickupNow = pickupWindow(ctx.now());
  const pickupWarning =
    pickupNow.when === 'within_the_hour'
      ? ''
      : ` Also tell them that, as it's outside pickup hours, pickup would be ${pickupNow.label} if they pay now.`;

  return {
    status: 'ok',
    quote_id: quoteId,
    pickup: { name: pickup.name, address: pickup.address },
    dropoff: { name: dropoff.name, address: dropoff.address },
    road_km: price.roadKm,
    price: {
      base_fee: price.breakdown.baseFee,
      per_km: price.breakdown.perKm,
      distance_charge: price.breakdown.distanceCharge,
      minimum_applied: price.breakdown.minimumApplied,
    },
    total_naira: price.total,
    expires_at: lagosTime(expiresAt).iso,
    expires_at_label: lagosTime(expiresAt).label,
    valid_for_minutes: QUOTE_TTL_MINUTES,
    pickup_if_paid_now: { when: pickupNow.when, label: pickupNow.label },
    next_step: `Read back both resolved addresses, the distance and the total in naira exactly as given, and say the price holds for 30 minutes.${pickupWarning} Ask the customer to confirm before collecting their name and email.`,
  };
}
