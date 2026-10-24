import { beforeEach, describe, expect, it, vi } from 'vitest';
import { searchPlaces } from '../../src/services/places';
import { createContext, ToolContext } from '../../src/tools/context';
import { resolveAddress } from '../../src/tools/resolve-address';

vi.mock('../../src/services/places');

const LEKKI = { name: 'Lekki Phase 1', address: 'Lekki Phase 1, Lagos', location: { latitude: 6.4478, longitude: 3.4723 } };
const AJAH = { name: 'Lekki-Ajah', address: 'Ajah, Lagos', location: { latitude: 6.4698, longitude: 3.5852 } };

let ctx: ToolContext;
beforeEach(() => {
  vi.resetAllMocks();
  ctx = createContext();
});

describe('resolveAddress', () => {
  it('stores a confident match and hands back its id with the resolved address', async () => {
    vi.mocked(searchPlaces).mockResolvedValue({ status: 'ok', place: LEKKI });
    const result = await resolveAddress({ query: 'Lekki Phase 1' }, ctx);

    expect(result).toMatchObject({ status: 'ok', name: 'Lekki Phase 1', address: 'Lekki Phase 1, Lagos' });
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(ctx.addresses.get(result.address_id)).toEqual(LEKKI);
  });

  it('stores every option of an ambiguous match so the customer’s pick can be quoted directly', async () => {
    vi.mocked(searchPlaces).mockResolvedValue({ status: 'ambiguous', candidates: [LEKKI, AJAH] });
    const result = await resolveAddress({ query: 'Lekki' }, ctx);

    if (result.status !== 'ambiguous') throw new Error('expected ambiguous');
    expect(result.options.map((o) => o.name)).toEqual(['Lekki Phase 1', 'Lekki-Ajah']);
    expect(ctx.addresses.get(result.options[1].address_id)).toEqual(AJAH);
    expect(result.next_step).toMatch(/which/i);
  });

  it('asks for a landmark when nothing matches', async () => {
    vi.mocked(searchPlaces).mockResolvedValue({ status: 'not_found' });
    const result = await resolveAddress({ query: 'by the big church' }, ctx);
    expect(result).toMatchObject({ status: 'not_found' });
    expect(result.next_step).toMatch(/landmark/i);
  });

  it('asks for a street or landmark inside a district too large to price from', async () => {
    vi.mocked(searchPlaces).mockResolvedValue({ status: 'too_broad', name: 'Lekki' });
    const result = await resolveAddress({ query: 'Lekki' }, ctx);
    expect(result).toMatchObject({ status: 'too_broad', area: 'Lekki' });
    expect(result.next_step).toMatch(/Lekki/);
    expect(result.next_step).toMatch(/street|landmark/i);
  });

  it('says where the place is when it is outside Lagos', async () => {
    vi.mocked(searchPlaces).mockResolvedValue({ status: 'out_of_area', foundIn: 'Ibadan, Oyo, Nigeria' });
    const result = await resolveAddress({ query: 'Ibadan' }, ctx);
    expect(result).toMatchObject({ status: 'out_of_area', found_in: 'Ibadan, Oyo, Nigeria' });
    expect(result.next_step).toMatch(/Lagos/);
  });

  it('hands off on a provider failure, keeping the detail for whoever debugs it', async () => {
    vi.mocked(searchPlaces).mockResolvedValue({ status: 'provider_error', detail: 'PERMISSION_DENIED: nope' });
    const result = await resolveAddress({ query: 'Yaba' }, ctx);
    expect(result).toMatchObject({ status: 'provider_error', detail: 'PERMISSION_DENIED: nope' });
    expect(result.next_step).toMatch(/human/i);
  });
});
