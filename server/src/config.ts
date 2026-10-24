/**
 * Swiftbox Dispatch business rules. The single source of truth for prices, coverage and hours:
 * the skill deliberately never states these figures, so the agent can only quote what a tool
 * computed from here and the two can never drift apart.
 */

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export const RATE_CARD = {
  /** Naira charged on every job before distance. */
  baseFee: 1_500,
  /** Naira per kilometre of road distance, never straight-line. */
  perKm: 300,
  /** Floor for short hops. */
  minimumFee: 2_500,
  /** Totals are rounded up to this many naira. */
  roundTo: 100,
  /** Longest road distance a bike job is accepted for. */
  maxRoadKm: 40,
} as const;

export type RateCard = typeof RATE_CARD;

/** Address searches are restricted to this rectangle; it encloses Lagos State. */
export const LAGOS_BOUNDS: { low: Coordinates; high: Coordinates } = {
  low: { latitude: 6.36, longitude: 2.7 },
  high: { latitude: 6.75, longitude: 4.35 },
};

/** The rectangle also clips Ogun State, so results must name Lagos as their state too. */
export const SERVICE_STATE = 'Lagos';

/**
 * Pickup and drop-off closer than this are treated as the same place: a mis-resolved address,
 * not a job.
 */
export const SAME_PLACE_METERS = 150;

/**
 * Search candidates within this distance of each other describe one area: "Lekki Phase 1" returns
 * the estate's centroid and an apartment listing inside it ~1.9km apart. Spread wider than this
 * ("Lekki" → Phase 1, Ajah, Ikoyi) is a genuine ambiguity the customer has to settle. At ₦300/km,
 * the spread folded together here moves a price by well under ₦1,000.
 */
export const AMBIGUITY_RADIUS_METERS = 2_500;

/**
 * A match whose viewport diagonal is wider than this is a district, not a place: pricing from its
 * centre could be several kilometres off. Measured on real Lagos results — Lekki (74.7km), Ikeja
 * (27.5km) and Surulere (9.4km) are refused; Lekki Phase 1 (6.0km), Ajah (6.5km) and Yaba (3.2km)
 * are fine. Viewport rather than place type, because Google's types are inconsistent here
 * (Victoria Island comes back as an "island", Yaba as a "neighborhood").
 */
export const MAX_AREA_SPAN_METERS = 8_000;

/** How long a quote, and the transfer account issued against it, stays valid. */
export const QUOTE_TTL_MINUTES = 30;

export const HOURS = {
  timezone: 'Africa/Lagos',
  /** ISO weekdays the riders work: Monday (1) to Saturday (6). */
  workingDays: [1, 2, 3, 4, 5, 6],
  /** First pickups go out at this hour. */
  openMinutes: 8 * 60,
  /** A job paid after this is picked up the next working morning. */
  sameDayCutoffMinutes: 17 * 60 + 30,
} as const;

/** Mock roster standing in for the dispatcher's riders. Names and numbers are invented. */
export const RIDERS = [
  { name: 'Tunde', phone: '+234 800 000 0101', bike: 'Bajaj Boxer, LAG 214 KJA' },
  { name: 'Chinedu', phone: '+234 800 000 0102', bike: 'TVS HLX, LAG 587 EPE' },
  { name: 'Musa', phone: '+234 800 000 0103', bike: 'Bajaj Boxer, LAG 033 IKJ' },
  { name: 'Bisi', phone: '+234 800 000 0104', bike: 'Honda Ace, LAG 761 LND' },
] as const;

export type Rider = (typeof RIDERS)[number];
