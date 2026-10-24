/**
 * Road distance between two points, from the Google Routes API.
 *
 * Road, never straight-line: a bike from Yaba to Lekki Phase 1 rides ~17.7km, as against
 * ~13km for a crow-flies distance, so pricing the straight line would undercharge every job.
 * DRIVE is the closest mode Routes offers for a dispatch bike in Lagos.
 */

import { Coordinates } from '../config.js';
import { googlePost } from './google.js';

const ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

export type RoadDistance = { ok: true; meters: number } | { ok: false; detail: string };

export async function roadDistanceMeters(from: Coordinates, to: Coordinates): Promise<RoadDistance> {
  const result = await googlePost<{ routes?: { distanceMeters?: number }[] }>(
    ROUTES_URL,
    'routes.distanceMeters',
    {
      origin: { location: { latLng: from } },
      destination: { location: { latLng: to } },
      travelMode: 'DRIVE',
    },
  );
  if (!result.ok) return result;

  const meters = result.data.routes?.[0]?.distanceMeters;
  if (typeof meters !== 'number') return { ok: false, detail: 'No drivable route found' };
  return { ok: true, meters };
}
