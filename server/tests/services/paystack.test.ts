import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTransferCharge, verifyTransaction } from '../../src/services/paystack';

// Bodies below are copied from real Paystack test-mode responses.
const respond = (body: unknown, status = 200) =>
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));

const CHARGE = {
  reference: 'SWB-Q7K2M9',
  amountNaira: 6_900,
  email: 'ada@example.com',
  expiresAt: new Date('2026-10-21T10:30:00Z'),
  metadata: { quote_id: 'Q7K2M9' },
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  vi.stubEnv('PAYSTACK_SECRET_KEY', 'sk_test_abc');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('createTransferCharge', () => {
  it('charges in kobo by bank transfer, with the account expiring with the quote', async () => {
    respond({ status: true, data: {} });
    await createTransferCharge(CHARGE);

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe('https://api.paystack.co/charge');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer sk_test_abc');
    expect(JSON.parse(String(init?.body))).toEqual({
      email: 'ada@example.com',
      amount: 690_000,
      reference: 'SWB-Q7K2M9',
      bank_transfer: { account_expires_at: '2026-10-21T10:30:00.000Z' },
      metadata: { quote_id: 'Q7K2M9' },
    });
  });

  it('returns the account the customer should transfer to', async () => {
    respond({
      status: true,
      message: 'Charge attempted',
      data: {
        reference: 'SWB-Q7K2M9',
        status: 'pending_bank_transfer',
        account_name: 'PAYSTACK CHECKOUT',
        account_number: '1260874612',
        bank: { slug: 'test-bank', name: 'Test Bank', id: 24 },
        account_expires_at: '2026-10-21T10:30:00.000Z',
        amount: 690_000,
      },
    });
    expect(await createTransferCharge(CHARGE)).toEqual({
      ok: true,
      account: {
        bank: 'Test Bank',
        accountNumber: '1260874612',
        accountName: 'PAYSTACK CHECKOUT',
        amountNaira: 6_900,
        expiresAt: '2026-10-21T10:30:00.000Z',
      },
    });
  });

  it('recognises a reference that already has a charge', async () => {
    respond(
      { status: false, message: 'Duplicate Transaction Reference', type: 'validation_error', code: 'duplicate_reference' },
      400,
    );
    expect(await createTransferCharge(CHARGE)).toEqual({
      ok: false,
      reason: 'duplicate_reference',
      detail: 'Duplicate Transaction Reference',
    });
  });

  it('recognises an email Paystack will not accept', async () => {
    respond({ status: false, message: 'Invalid email address', type: 'validation_error', code: 'invalid_params' }, 400);
    expect(await createTransferCharge(CHARGE)).toMatchObject({ ok: false, reason: 'invalid_email' });
  });

  it('reports any other refusal with Paystack’s message', async () => {
    respond({ status: false, message: 'Dedicated NUBAN is not available for your business', code: 'feature_unavailable' }, 400);
    expect(await createTransferCharge(CHARGE)).toEqual({
      ok: false,
      reason: 'paystack_error',
      detail: 'Dedicated NUBAN is not available for your business',
    });
  });

  it('reports a network failure instead of throwing', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('fetch failed'));
    expect(await createTransferCharge(CHARGE)).toEqual({ ok: false, reason: 'paystack_error', detail: 'fetch failed' });
  });

  it('refuses to run with a live secret key', async () => {
    vi.stubEnv('PAYSTACK_SECRET_KEY', 'sk_live_abc');
    expect(await createTransferCharge(CHARGE)).toEqual({
      ok: false,
      reason: 'paystack_error',
      detail: 'Refusing to run with a live Paystack key: this exercise uses test mode only',
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('verifyTransaction', () => {
  it('returns the transaction status, amount in naira and metadata', async () => {
    respond({
      status: true,
      data: {
        status: 'success',
        gateway_response: 'Approved',
        amount: 690_000,
        currency: 'NGN',
        paid_at: '2026-10-21T10:05:00.000Z',
        metadata: { quote_id: 'Q7K2M9' },
      },
    });
    expect(await verifyTransaction('SWB-Q7K2M9')).toEqual({
      ok: true,
      transaction: {
        status: 'success',
        gatewayResponse: 'Approved',
        amountNaira: 6_900,
        currency: 'NGN',
        paidAt: '2026-10-21T10:05:00.000Z',
        metadata: { quote_id: 'Q7K2M9' },
      },
    });
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe('https://api.paystack.co/transaction/verify/SWB-Q7K2M9');
  });

  it('reads metadata that Paystack returns as a JSON string', async () => {
    respond({
      status: true,
      data: { status: 'ongoing', gateway_response: '', amount: 690_000, currency: 'NGN', paid_at: null, metadata: '{"quote_id":"Q7K2M9"}' },
    });
    const result = await verifyTransaction('SWB-Q7K2M9');
    expect(result.ok && result.transaction.metadata).toEqual({ quote_id: 'Q7K2M9' });
  });

  it('treats empty metadata as an empty object', async () => {
    respond({
      status: true,
      data: { status: 'failed', gateway_response: 'Account expired', amount: 750_000, currency: 'NGN', paid_at: null, metadata: '' },
    });
    const result = await verifyTransaction('SWB-Q7K2M9');
    expect(result.ok && result.transaction.metadata).toEqual({});
  });

  it('recognises a reference Paystack has never seen', async () => {
    respond(
      { status: false, message: 'Transaction reference not found.', type: 'validation_error', code: 'transaction_not_found' },
      400,
    );
    expect(await verifyTransaction('SWB-NOSUCH')).toEqual({
      ok: false,
      reason: 'not_found',
      detail: 'Transaction reference not found.',
    });
  });
});
