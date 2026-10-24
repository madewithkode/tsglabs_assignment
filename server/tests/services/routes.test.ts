import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { roadDistanceMeters } from '../../src/services/routes';

const YABA = { latitude: 6.5095, longitude: 3.3711 };
const LEKKI = { latitude: 6.4478, longitude: 3.4723 };

const respond = (body: unknown, status = 200) =>
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  vi.stubEnv('GOOGLE_MAPS_API_KEY', 'test-key');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('roadDistanceMeters', () => {
  it('asks Routes for a driving route between the two points', async () => {
    respond({ routes: [{ distanceMeters: 17_727 }] });
    await roadDistanceMeters(YABA, LEKKI);

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
    expect(JSON.parse(String(init?.body))).toEqual({
      origin: { location: { latLng: YABA } },
      destination: { location: { latLng: LEKKI } },
      travelMode: 'DRIVE',
    });
  });

  it('returns the road distance of the first route', async () => {
    respond({ routes: [{ distanceMeters: 17_727 }] });
    expect(await roadDistanceMeters(YABA, LEKKI)).toEqual({ ok: true, meters: 17_727 });
  });

  it('fails when Google finds no drivable route', async () => {
    respond({});
    expect(await roadDistanceMeters(YABA, LEKKI)).toEqual({ ok: false, detail: 'No drivable route found' });
  });

  it('passes Google’s refusal through as the failure detail', async () => {
    respond({ error: { status: 'PERMISSION_DENIED', message: 'Routes API has not been used in project 123.' } }, 403);
    expect(await roadDistanceMeters(YABA, LEKKI)).toEqual({
      ok: false,
      detail: 'PERMISSION_DENIED: Routes API has not been used in project 123.',
    });
  });
});
