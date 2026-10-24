import { beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyTransaction, Transaction } from '../../src/services/paystack';
import { assignRider } from '../../src/services/dispatch';
import { createContext, ToolContext } from '../../src/tools/context';
import { confirmBooking } from '../../src/tools/confirm-booking';

vi.mock('../../src/services/paystack');

// The snapshot create_payment wrote onto the transaction.
const METADATA = {
  quote_id: 'Q7K2M9',
  total_naira: 6_900,
  expires_at: '2026-10-21T09:30:00.000Z',
  item: 'A pair of shoes',
  pickup: { address: 'Herbert Macaulay Way, Yaba, Lagos', contact: { name: 'Adaeze Okafor', phone: '08030000001' } },
  dropoff: { address: 'Lekki Phase 1, Lagos', contact: { name: 'Kunle Bello', phone: '08030000002' } },
};

const transaction = (overrides: Partial<Transaction>): Transaction => ({
  status: 'success',
  gatewayResponse: 'Approved',
  amountNaira: 6_900,
  currency: 'NGN',
  // Tuesday 10:05 WAT
  paidAt: '2026-10-21T09:05:00.000Z',
  metadata: METADATA,
  ...overrides,
});

let ctx: ToolContext;
beforeEach(() => {
  vi.resetAllMocks();
  ctx = createContext(() => new Date('2026-10-21T09:10:00Z'));
});

const confirm = (quote_id = 'Q7K2M9') => confirmBooking({ quote_id }, ctx);

describe('confirmBooking', () => {
  it('verifies the payment with Paystack using the reference derived from the quote', async () => {
    vi.mocked(verifyTransaction).mockResolvedValue({ ok: true, transaction: transaction({}) });
    await confirm(' q7k2m9 ');
    expect(verifyTransaction).toHaveBeenCalledWith('SWB-Q7K2M9');
  });

  it('books a rider once Paystack confirms the exact amount arrived', async () => {
    vi.mocked(verifyTransaction).mockResolvedValue({ ok: true, transaction: transaction({}) });
    const rider = assignRider('SWB-Q7K2M9');

    expect(await confirm()).toMatchObject({
      status: 'confirmed',
      booking_reference: 'SWB-Q7K2M9',
      amount_paid_naira: 6_900,
      rider: { name: rider.name, phone: rider.phone, bike: rider.bike },
      pickup_window: 'Today, by 11:05am',
      pickup: { address: 'Herbert Macaulay Way, Yaba, Lagos', contact: { name: 'Adaeze Okafor' } },
      dropoff: { address: 'Lekki Phase 1, Lagos', contact: { name: 'Kunle Bello' } },
    });
  });

  it('returns the same booking when asked again', async () => {
    vi.mocked(verifyTransaction).mockResolvedValue({ ok: true, transaction: transaction({}) });
    expect(await confirm()).toEqual(await confirm());
  });

  it('refuses to book a payment for a different amount and hands off', async () => {
    vi.mocked(verifyTransaction).mockResolvedValue({ ok: true, transaction: transaction({ amountNaira: 3_000 }) });
    const result = await confirm();
    expect(result).toMatchObject({ status: 'amount_mismatch', expected_naira: 6_900, received_naira: 3_000 });
    expect(result.next_step).toMatch(/human/i);
  });

  it('refuses to book a payment in another currency', async () => {
    vi.mocked(verifyTransaction).mockResolvedValue({ ok: true, transaction: transaction({ currency: 'GHS' }) });
    expect((await confirm()).status).toBe('amount_mismatch');
  });

  it('says the money has not arrived yet while the transfer is still pending, with time left', async () => {
    vi.mocked(verifyTransaction).mockResolvedValue({
      ok: true,
      transaction: transaction({ status: 'ongoing', paidAt: null, gatewayResponse: 'Please make a transfer to the account specified' }),
    });
    const result = await confirm();
    expect(result).toMatchObject({
      status: 'not_received_yet',
      minutes_left: 20,
      expires_at: '2026-10-21T10:30:00+01:00',
      expires_at_label: '10:30am',
    });
    expect(result.next_step).toMatch(/screenshot/i);
  });

  it('tells an expired transfer account apart from a failed payment', async () => {
    vi.mocked(verifyTransaction).mockResolvedValue({
      ok: true,
      transaction: transaction({ status: 'failed', paidAt: null, gatewayResponse: 'Account expired' }),
    });
    const result = await confirm();
    expect(result.status).toBe('expired');
    expect(result.next_step).toMatch(/get_quote/);
  });

  it('reports a failed payment with Paystack’s reason', async () => {
    vi.mocked(verifyTransaction).mockResolvedValue({
      ok: true,
      transaction: transaction({ status: 'abandoned', paidAt: null, gatewayResponse: 'Abandoned' }),
    });
    expect(await confirm()).toMatchObject({ status: 'failed', paystack_status: 'abandoned', detail: 'Abandoned' });
  });

  it('says no payment was started when Paystack has never seen the reference', async () => {
    vi.mocked(verifyTransaction).mockResolvedValue({ ok: false, reason: 'not_found', detail: 'Transaction reference not found.' });
    const result = await confirm();
    expect(result.status).toBe('no_payment_started');
    expect(result.next_step).toMatch(/create_payment/);
  });

  it('hands off when Paystack cannot be reached', async () => {
    vi.mocked(verifyTransaction).mockResolvedValue({ ok: false, reason: 'paystack_error', detail: 'fetch failed' });
    const result = await confirm();
    expect(result).toMatchObject({ status: 'paystack_error', detail: 'fetch failed' });
    expect(result.next_step).toMatch(/human/i);
  });
});
