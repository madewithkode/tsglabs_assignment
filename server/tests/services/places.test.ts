import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { searchPlaces } from '../../src/services/places';

/** `spanKm` is roughly the viewport's diagonal: ~0.4 for a building, ~75 for all of Lekki. */
type Place = { name: string; address: string; lat: number; lng: number; state: string; spanKm?: number };

const place = ({ name, address, lat, lng, state, spanKm = 0.4 }: Place) => {
  const half = spanKm / 2 / 111 / Math.SQRT2;
  return {
    displayName: { text: name },
    formattedAddress: address,
    location: { latitude: lat, longitude: lng },
    viewport: {
      low: { latitude: lat - half, longitude: lng - half },
      high: { latitude: lat + half, longitude: lng + half },
    },
    addressComponents: [
      { longText: state, types: ['administrative_area_level_1', 'political'] },
      { longText: 'Nigeria', types: ['country', 'political'] },
    ],
  };
};

const LEKKI_PHASE_1 = { name: 'Lekki Phase 1', address: 'Lekki Phase 1, Lekki 106104, Lagos', lat: 6.4478, lng: 3.4723, state: 'Lagos' };
const LEKKI_LISTING = { name: 'Cozy 3BD Apartment', address: 'Lekki Phase I, Lekki 106104, Lagos, Nigeria', lat: 6.4337, lng: 3.4818, state: 'Lagos' };
const AJAH = { name: 'Lekki-Ajah', address: 'Ajah, Lekki, Lagos', lat: 6.4698, lng: 3.5852, state: 'Lagos' };
const IKOYI = { name: 'Ikoyi', address: 'Ikoyi, Lagos', lat: 6.4549, lng: 3.4246, state: 'Lagos' };
const IBADAN = { name: 'Ibadan', address: 'Ibadan, Oyo, Nigeria', lat: 7.3775, lng: 3.947, state: 'Oyo' };

const respond = (body: unknown, status = 200) =>
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  );

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  vi.stubEnv('GOOGLE_MAPS_API_KEY', 'test-key');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('searchPlaces', () => {
  it('biases the search towards Lagos and asks only for the fields it uses', async () => {
    respond({ places: [place(LEKKI_PHASE_1)] });
    await searchPlaces('Lekki Phase 1');

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://places.googleapis.com/v1/places:searchText');
    const headers = init?.headers as Record<string, string>;
    expect(headers['X-Goog-Api-Key']).toBe('test-key');
    expect(headers['X-Goog-FieldMask']).toContain('places.addressComponents');
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({ textQuery: 'Lekki Phase 1', regionCode: 'NG' });
    expect(body.locationBias.rectangle).toBeDefined();
  });

  it('resolves to the top result when every candidate sits in the same area', async () => {
    respond({ places: [place(LEKKI_PHASE_1), place(LEKKI_LISTING)] });
    const result = await searchPlaces('Lekki Phase 1');
    expect(result).toEqual({
      status: 'ok',
      place: {
        name: 'Lekki Phase 1',
        address: 'Lekki Phase 1, Lekki 106104, Lagos',
        location: { latitude: 6.4478, longitude: 3.4723 },
      },
    });
  });

  it('returns a shortlist when candidates are far apart', async () => {
    respond({ places: [place(LEKKI_PHASE_1), place(LEKKI_LISTING), place(AJAH), place(IKOYI)] });
    const result = await searchPlaces('Lekki');
    expect(result.status).toBe('ambiguous');
    if (result.status === 'ambiguous') {
      // The listing is inside Lekki Phase 1, so it is folded into that option rather than offered.
      expect(result.candidates.map((c) => c.name)).toEqual(['Lekki Phase 1', 'Lekki-Ajah', 'Ikoyi']);
    }
  });

  it('refuses to pin a whole district, which would price from its centre', async () => {
    const LEKKI_DISTRICT = { name: 'Lekki', address: 'Lekki, Lagos', lat: 6.4698, lng: 3.5852, state: 'Lagos', spanKm: 74.7 };
    respond({ places: [place(LEKKI_DISTRICT), place(LEKKI_PHASE_1)] });
    expect(await searchPlaces('Lekki')).toEqual({ status: 'too_broad', name: 'Lekki' });
  });

  it('accepts an estate-sized area as precise enough to price', async () => {
    respond({ places: [place({ ...LEKKI_PHASE_1, spanKm: 6 })] });
    expect((await searchPlaces('Lekki Phase 1')).status).toBe('ok');
  });

  it('leaves a broad runner-up out of the shortlist when the top match is precise', async () => {
    const IKEJA_DISTRICT = { name: 'Ikeja', address: 'Ikeja, Lagos', lat: 6.6018, lng: 3.3515, state: 'Lagos', spanKm: 27.5 };
    respond({ places: [place(LEKKI_PHASE_1), place(IKEJA_DISTRICT)] });
    expect(await searchPlaces('Phase 1')).toMatchObject({ status: 'ok', place: { name: 'Lekki Phase 1' } });
  });

  it('keeps the Lagos match and ignores a same-named place in another state', async () => {
    respond({ places: [place(IBADAN), place(IKOYI)] });
    const result = await searchPlaces('Ikoyi');
    expect(result).toMatchObject({ status: 'ok', place: { name: 'Ikoyi' } });
  });

  it('reports out of area, naming where it found the place, when nothing is in Lagos', async () => {
    respond({ places: [place(IBADAN)] });
    expect(await searchPlaces('Ibadan')).toEqual({
      status: 'out_of_area',
      foundIn: 'Ibadan, Oyo, Nigeria',
    });
  });

  it('reports not found when Google has no match at all', async () => {
    respond({});
    expect(await searchPlaces('by the big church near the junction')).toEqual({ status: 'not_found' });
  });

  it('reports a provider error with Google’s own message when the request is refused', async () => {
    respond(
      { error: { code: 403, status: 'PERMISSION_DENIED', message: 'Places API (New) has not been used in project 123 before or it is disabled.' } },
      403,
    );
    const result = await searchPlaces('Yaba');
    expect(result).toEqual({
      status: 'provider_error',
      detail: 'PERMISSION_DENIED: Places API (New) has not been used in project 123 before or it is disabled.',
    });
  });

  it('reports a provider error instead of throwing when the network fails', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('The operation was aborted due to timeout'));
    expect(await searchPlaces('Yaba')).toEqual({
      status: 'provider_error',
      detail: 'The operation was aborted due to timeout',
    });
  });

  it('reports a provider error without calling Google when no key is configured', async () => {
    vi.stubEnv('GOOGLE_MAPS_API_KEY', '');
    expect(await searchPlaces('Yaba')).toEqual({
      status: 'provider_error',
      detail: 'GOOGLE_MAPS_API_KEY is not set',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
