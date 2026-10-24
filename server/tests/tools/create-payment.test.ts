import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTransferCharge } from '../../src/services/paystack';
import { createContext, Quote, ToolContext } from '../../src/tools/context';
import { createPayment } from '../../src/tools/create-payment';

vi.mock('../../src/services/paystack');

const QUOTE: Quote = {
  pickup: { name: 'Yaba', address: 'Herbert Macaulay Way, Yaba, Lagos', location: { latitude: 6.5095, longitude: 3.3711 } },
  dropoff: { name: 'Lekki Phase 1', address: 'Lekki Phase 1, Lagos', location: { latitude: 6.4478, longitude: 3.4723 } },
  item: 'A pair of shoes',
  roadKm: 17.73,
  breakdown: { baseFee: 1_500, perKm: 300, distanceCharge: 5_318, minimumApplied: false },
  totalNaira: 6_900,
  expiresAt: '2026-10-21T09:30:00.000Z',
};

const ACCOUNT = {
  bank: 'Test Bank',
  accountNumber: '1260874612',
  accountName: 'PAYSTACK CHECKOUT',
  amountNaira: 6_900,
  expiresAt: '2026-10-21T09:30:00.000Z',
};

let ctx: ToolContext;
let quoteId: string;

beforeEach(() => {
  vi.resetAllMocks();
  ctx = createContext(() => new Date('2026-10-21T09:05:00Z'));
  quoteId = ctx.quotes.put(QUOTE);
});

const pay = (overrides: Partial<Parameters<typeof createPayment>[0]> = {}) =>
  createPayment(
    {
      quote_id: quoteId,
      customer_name: 'Adaeze Okafor',
      customer_email: 'ada@example.com',
      // Flat strings, not {name, phone} objects: Chord shows the model nested object arguments as
      // plain strings, so a nested schema was rejected on every call in the console.
      pickup_contact_name: 'Adaeze Okafor',
      pickup_contact_phone: '08030000001',
      dropoff_contact_name: 'Kunle Bello',
      dropoff_contact_phone: '08030000002',
      ...overrides,
    },
    ctx,
  );

describe('createPayment', () => {
  it('charges the stored quote total, never an amount from the conversation', async () => {
    vi.mocked(createTransferCharge).mockResolvedValue({ ok: true, account: ACCOUNT });
    await pay();

    const request = vi.mocked(createTransferCharge).mock.calls[0][0];
    expect(request).toMatchObject({
      reference: `SWB-${quoteId}`,
      amountNaira: 6_900,
      email: 'ada@example.com',
      expiresAt: new Date('2026-10-21T09:30:00.000Z'),
    });
  });

  it('records the whole job on the Paystack transaction, contacts grouped, so the booking needs no database', async () => {
    vi.mocked(createTransferCharge).mockResolvedValue({ ok: true, account: ACCOUNT });
    await pay();

    const { metadata } = vi.mocked(createTransferCharge).mock.calls[0][0];
    expect(metadata).toMatchObject({
      quote_id: quoteId,
      total_naira: 6_900,
      expires_at: '2026-10-21T09:30:00.000Z',
      item: 'A pair of shoes',
      road_km: 17.73,
      customer: { name: 'Adaeze Okafor', email: 'ada@example.com' },
      pickup: { address: 'Herbert Macaulay Way, Yaba, Lagos', contact: { name: 'Adaeze Okafor', phone: '08030000001' } },
      dropoff: { address: 'Lekki Phase 1, Lagos', contact: { name: 'Kunle Bello', phone: '08030000002' } },
    });
    // Shown as columns on the Paystack dashboard, where the dispatcher looks.
    expect(metadata.custom_fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ variable_name: 'pickup', value: 'Herbert Macaulay Way, Yaba, Lagos' })]),
    );
  });

  it('returns the exact transfer details for the customer', async () => {
    vi.mocked(createTransferCharge).mockResolvedValue({ ok: true, account: ACCOUNT });
    const result = await pay();
    expect(result).toMatchObject({
      status: 'ok',
      reference: `SWB-${quoteId}`,
      bank: 'Test Bank',
      account_number: '1260874612',
      account_name: 'PAYSTACK CHECKOUT',
      amount_naira: 6_900,
      expires_at: '2026-10-21T10:30:00+01:00',
      expires_at_label: '10:30am',
      reused: false,
    });
    // The reference is what links later messages to this payment, so the customer must see it.
    expect(result.next_step).toContain(`booking reference (SWB-${quoteId})`);
    expect(result.next_step).toMatch(/confirm_booking with that reference/);
  });

  it('gives the same account again on a repeat call, without a second charge', async () => {
    vi.mocked(createTransferCharge).mockResolvedValue({ ok: true, account: ACCOUNT });
    await pay();
    const again = await pay();
    expect(again).toMatchObject({ status: 'ok', account_number: '1260874612', reused: true });
    expect(createTransferCharge).toHaveBeenCalledTimes(1);
  });

  it('rejects a malformed email before it reaches Paystack', async () => {
    const result = await pay({ customer_email: 'ada@gmail' });
    expect(result.status).toBe('invalid_email');
    expect(result.next_step).toMatch(/email/i);
    expect(createTransferCharge).not.toHaveBeenCalled();
  });

  it('sends the agent back to quoting when the quote has expired', async () => {
    const result = await pay({ quote_id: 'QGONE2' });
    expect(result.status).toBe('quote_expired');
    expect(result.next_step).toMatch(/get_quote/);
    expect(createTransferCharge).not.toHaveBeenCalled();
  });

  it('points to confirm_booking when Paystack already holds a charge for this quote', async () => {
    vi.mocked(createTransferCharge).mockResolvedValue({ ok: false, reason: 'duplicate_reference', detail: 'Duplicate Transaction Reference' });
    const result = await pay();
    expect(result.status).toBe('already_issued');
    expect(result.next_step).toMatch(/confirm_booking/);
  });

  it('hands off when Paystack refuses for any other reason', async () => {
    vi.mocked(createTransferCharge).mockResolvedValue({ ok: false, reason: 'paystack_error', detail: 'fetch failed' });
    const result = await pay();
    expect(result).toMatchObject({ status: 'paystack_error', detail: 'fetch failed' });
    expect(result.next_step).toMatch(/human/i);
  });
});
