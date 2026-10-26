import { beforeEach, describe, expect, it, vi } from 'vitest';
import { roadDistanceMeters } from '../../src/services/routes';
import { createContext, ToolContext } from '../../src/tools/context';
import { getQuote } from '../../src/tools/get-quote';

vi.mock('../../src/services/routes');

const YABA = { name: 'Yaba', address: 'Herbert Macaulay Way, Yaba, Lagos', location: { latitude: 6.5095, longitude: 3.3711 } };
const LEKKI = { name: 'Lekki Phase 1', address: 'Lekki Phase 1, Lagos', location: { latitude: 6.4478, longitude: 3.4723 } };
const YABA_NEXT_DOOR = { ...YABA, location: { latitude: 6.5096, longitude: 3.3712 } };
const BADAGRY = { name: 'Badagry', address: 'Badagry, Lagos', location: { latitude: 6.4153, longitude: 2.8813 } };
const EPE = { name: 'Epe', address: 'Epe, Lagos', location: { latitude: 6.5841, longitude: 3.9834 } };

const NOW = new Date('2026-10-21T09:00:00Z');

let ctx: ToolContext;
let yaba: string;
let lekki: string;

beforeEach(() => {
  vi.resetAllMocks();
  ctx = createContext(() => NOW);
  yaba = ctx.addresses.put(YABA);
  lekki = ctx.addresses.put(LEKKI);
});

const quote = (pickup: string, dropoff: string) =>
  getQuote({ pickup_address_id: pickup, dropoff_address_id: dropoff, item_description: 'A pair of shoes' }, ctx);

describe('getQuote', () => {
  it('prices the road distance and stores a quote that expires in 30 minutes', async () => {
    vi.mocked(roadDistanceMeters).mockResolvedValue({ ok: true, meters: 17_727 });
    const result = await quote(yaba, lekki);

    expect(result).toMatchObject({
      status: 'ok',
      pickup: { name: 'Yaba', address: 'Herbert Macaulay Way, Yaba, Lagos' },
      dropoff: { name: 'Lekki Phase 1', address: 'Lekki Phase 1, Lagos' },
      road_km: 17.73,
      price: { base_fee: 1_500, per_km: 300, distance_charge: 5_318, minimum_applied: false },
      total_naira: 6_900,
      // Lagos time, never raw UTC: a model read "09:30Z" as 9:30am local and called a live quote expired.
      expires_at: '2026-10-21T10:30:00+01:00',
      expires_at_label: '10:30am',
    });
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(ctx.quotes.get(result.quote_id)).toMatchObject({
      pickup: YABA,
      dropoff: LEKKI,
      item: 'A pair of shoes',
      totalNaira: 6_900,
    });
  });

  it('says when pickup would be if the customer paid now', async () => {
    // Tuesday 10:00 WAT: a working-hours job goes out within the hour.
    vi.mocked(roadDistanceMeters).mockResolvedValue({ ok: true, meters: 17_727 });
    const result = await quote(yaba, lekki);
    expect(result).toMatchObject({
      pickup_if_paid_now: { when: 'within_the_hour', label: 'Today, by 11:00am' },
    });
    // Nothing unusual to warn about, so the agent isn't told to mention it.
    expect(result.next_step).not.toMatch(/pickup would be/);
  });

  it('tells the agent to stay quiet about a repeat quote whose only change is a later hold time', async () => {
    // In the simulator the agent re-quotes on later messages; each repeat has a new 30-minute hold.
    // An always-on "read it back and ask to confirm" made it announce "the hold time has been
    // refreshed" and re-read the whole quote after the customer had already accepted it.
    vi.mocked(roadDistanceMeters).mockResolvedValue({ ok: true, meters: 17_727 });
    const result = await quote(yaba, lekki);
    expect(result.next_step).toMatch(/If this is the first quote for this trip/);
    expect(result.next_step).toMatch(/hold time and pickup time moving later is normal and is not a change/);
    expect(result.next_step).toMatch(/Only tell the customer if the total, an address or the distance is different/);
  });

  it('warns before payment when pickup would be the next working morning', async () => {
    // Saturday 23:13 WAT: a customer paid, then learned the rider would come on Monday.
    ctx = createContext(() => new Date('2026-10-24T22:13:00Z'));
    vi.mocked(roadDistanceMeters).mockResolvedValue({ ok: true, meters: 29_750 });
    const result = await quote(ctx.addresses.put(YABA), ctx.addresses.put(LEKKI));

    expect(result).toMatchObject({
      pickup_if_paid_now: { when: 'next_working_morning', label: 'Monday 26 October, 8:00–9:00am' },
    });
    expect(result.next_step).toMatch(/pickup would be Monday 26 October, 8:00–9:00am/);
  });

  it('names which address id it no longer recognises', async () => {
    const result = await quote(yaba, 'ANOPE2');
    expect(result).toMatchObject({ status: 'unknown_address_id', which: 'dropoff' });
    expect(roadDistanceMeters).not.toHaveBeenCalled();
  });

  it('refuses identical pickup and drop-off without a road lookup', async () => {
    const result = await quote(yaba, ctx.addresses.put(YABA_NEXT_DOOR));
    expect(result.status).toBe('same_place');
    expect(roadDistanceMeters).not.toHaveBeenCalled();
  });

  it('refuses a pair already too far apart as the crow flies, without a road lookup', async () => {
    const result = await quote(ctx.addresses.put(BADAGRY), ctx.addresses.put(EPE));
    expect(result).toMatchObject({ status: 'out_of_range', max_km: 40 });
    if (result.status === 'out_of_range') expect(result.road_km).toBeGreaterThan(40);
    expect(roadDistanceMeters).not.toHaveBeenCalled();
  });

  it('refuses a job whose road distance is past the limit', async () => {
    vi.mocked(roadDistanceMeters).mockResolvedValue({ ok: true, meters: 46_000 });
    expect(await quote(yaba, lekki)).toMatchObject({ status: 'out_of_range', road_km: 46, max_km: 40 });
  });

  it('hands off instead of guessing when the road lookup fails', async () => {
    vi.mocked(roadDistanceMeters).mockResolvedValue({ ok: false, detail: 'timeout' });
    const result = await quote(yaba, lekki);
    expect(result).toMatchObject({ status: 'provider_error', detail: 'timeout' });
    expect(result.next_step).toMatch(/human/i);
  });
});
