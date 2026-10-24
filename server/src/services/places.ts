/**
 * Turns what a customer typed ("Shoprite Lekki", "12 Herbert Macaulay Way, Yaba") into a point.
 *
 * Places Text Search rather than Geocoding: Lagos customers describe places by landmark far more
 * often than by street number, and Text Search finds landmarks. The search is *biased* towards
 * Lagos, not restricted to it, so "Ibadan" still comes back as Ibadan — and can be refused with
 * a clear "that's in Oyo State" instead of a baffling "not found".
 */

import {
  AMBIGUITY_RADIUS_METERS,
  Coordinates,
  LAGOS_BOUNDS,
  MAX_AREA_SPAN_METERS,
  SERVICE_STATE,
} from '../config.js';
import { googlePost } from './google.js';
import { haversineMeters } from './pricing.js';

const SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const FIELD_MASK =
  'places.displayName,places.formattedAddress,places.location,places.viewport,places.addressComponents';
const MAX_RESULTS = 5;
const MAX_OPTIONS = 3;

export interface Place {
  name: string;
  address: string;
  location: Coordinates;
}

export type PlaceSearch =
  | { status: 'ok'; place: Place }
  | { status: 'ambiguous'; candidates: Place[] }
  /** The customer named a whole district ("Lekki"): too large to price from its centre. */
  | { status: 'too_broad'; name: string }
  | { status: 'out_of_area'; foundIn: string }
  | { status: 'not_found' }
  | { status: 'provider_error'; detail: string };

interface GooglePlace {
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: Coordinates;
  viewport?: { low?: Coordinates; high?: Coordinates };
  addressComponents?: { longText?: string; types?: string[] }[];
}

/** Diagonal of the area Google says the match covers; 0 when it gives no viewport. */
const spanMeters = (p: GooglePlace) =>
  p.viewport?.low && p.viewport?.high ? haversineMeters(p.viewport.low, p.viewport.high) : 0;

const stateOf = (p: GooglePlace) =>
  p.addressComponents?.find((c) => c.types?.includes('administrative_area_level_1'))?.longText ?? '';

const toPlace = (p: GooglePlace): Place => ({
  name: p.displayName?.text ?? p.formattedAddress ?? 'Unnamed place',
  address: p.formattedAddress ?? '',
  location: { latitude: p.location!.latitude, longitude: p.location!.longitude },
});

export async function searchPlaces(query: string): Promise<PlaceSearch> {
  const result = await googlePost<{ places?: GooglePlace[] }>(SEARCH_URL, FIELD_MASK, {
    textQuery: query,
    regionCode: 'NG',
    maxResultCount: MAX_RESULTS,
    locationBias: { rectangle: LAGOS_BOUNDS },
  });
  if (!result.ok) return { status: 'provider_error', detail: result.detail };

  const found = (result.data.places ?? []).filter((p) => p.location);
  if (found.length === 0) return { status: 'not_found' };

  const inLagos = found.filter((p) => stateOf(p).includes(SERVICE_STATE));
  if (inLagos.length === 0) return { status: 'out_of_area', foundIn: found[0].formattedAddress ?? '' };

  // If the best match is a whole district, what the customer typed is too vague to price —
  // whatever narrower places rank below it are guesses at what they meant, so none is taken.
  if (spanMeters(inLagos[0]) > MAX_AREA_SPAN_METERS) {
    return { status: 'too_broad', name: inLagos[0].displayName?.text ?? inLagos[0].formattedAddress ?? '' };
  }
  const precise = inLagos.filter((p) => spanMeters(p) <= MAX_AREA_SPAN_METERS).map(toPlace);

  // Fold candidates that sit within one area of an option already kept; whatever remains are
  // genuinely different places the customer has to choose between.
  const options: Place[] = [];
  for (const candidate of precise) {
    const sameAreaAsKept = options.some(
      (kept) => haversineMeters(kept.location, candidate.location) <= AMBIGUITY_RADIUS_METERS,
    );
    if (!sameAreaAsKept) options.push(candidate);
  }

  return options.length === 1
    ? { status: 'ok', place: options[0] }
    : { status: 'ambiguous', candidates: options.slice(0, MAX_OPTIONS) };
}
