import { describe, expect, it } from 'vitest';
import { RATE_CARD } from '../../src/config';
import { haversineMeters, priceRoadDistance, screenStraightLine } from '../../src/services/pricing';

const YABA = { latitude: 6.5095, longitude: 3.3711 };
const LEKKI_PHASE_1 = { latitude: 6.4478, longitude: 3.4723 };
const IBADAN = { latitude: 7.3775, longitude: 3.947 };

describe('haversineMeters', () => {
  it('measures Yaba to Lekki Phase 1 as roughly 13 km in a straight line', () => {
    const km = haversineMeters(YABA, LEKKI_PHASE_1) / 1000;
    expect(km).toBeGreaterThan(12.5);
    expect(km).toBeLessThan(14);
  });

  it('is zero for the same point', () => {
    expect(haversineMeters(YABA, YABA)).toBe(0);
  });
});

describe('screenStraightLine', () => {
  it('passes two points comfortably inside the service range', () => {
    expect(screenStraightLine(YABA, LEKKI_PHASE_1)).toEqual({ ok: true });
  });

  it('refuses a pair already beyond the road limit as the crow flies, before any road lookup', () => {
    const result = screenStraightLine(YABA, IBADAN);
    expect(result).toMatchObject({ ok: false, reason: 'out_of_range' });
    if (!result.ok && result.reason === 'out_of_range') {
      expect(result.atLeastKm).toBeGreaterThan(RATE_CARD.maxRoadKm);
    }
  });

  it('flags pickup and drop-off resolved to the same spot', () => {
    const nextDoor = { latitude: 6.5096, longitude: 3.3712 };
    expect(screenStraightLine(YABA, nextDoor)).toEqual({ ok: false, reason: 'same_place' });
  });
});

describe('priceRoadDistance', () => {
  it('charges base plus per-km on road distance, rounded up to the nearest ₦100', () => {
    // 1,500 + 300 × 17.727 = 6,818.1 → 6,900
    const result = priceRoadDistance(17_727);
    expect(result).toEqual({
      ok: true,
      roadKm: 17.73,
      breakdown: { baseFee: 1_500, perKm: 300, distanceCharge: 5_318, minimumApplied: false },
      total: 6_900,
    });
  });

  it('never rounds a total down', () => {
    // 1,500 + 300 × 10.001 = 4,500.3 → 4,600, not 4,500
    const result = priceRoadDistance(10_001);
    expect(result.ok && result.total).toBe(4_600);
  });

  it('applies the minimum fee to short hops and says so', () => {
    const result = priceRoadDistance(1_200);
    expect(result).toMatchObject({ ok: true, total: 2_500, breakdown: { minimumApplied: true } });
  });

  it('accepts a job exactly at the road limit', () => {
    expect(priceRoadDistance(RATE_CARD.maxRoadKm * 1000).ok).toBe(true);
  });

  it('refuses a job beyond the road limit and reports the distance', () => {
    expect(priceRoadDistance(40_500)).toEqual({ ok: false, reason: 'out_of_range', roadKm: 40.5 });
  });
});
