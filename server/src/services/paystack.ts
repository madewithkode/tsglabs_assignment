/**
 * Paystack, test mode only: Pay with Transfer through the Charge API, and transaction verification.
 *
 * Pay with Transfer rather than a checkout link so everything hsppens inside the channel of choice: the customer
 * gets an account number in the chat and pays from their own bank app, which is how most
 * customers already pay a dispatcher. Unlike a payment screenshot, the transfer can be verified.
 *
 * Never throws: every failure comes back as a reason plus Paystack's own message.
 */

const BASE_URL = 'https://api.paystack.co';
const timeoutMs = () => Number(process.env.PAYSTACK_TIMEOUT_MS || 10_000);

export interface TransferAccount {
  bank: string;
  accountNumber: string;
  accountName: string;
  amountNaira: number;
  expiresAt: string;
}

export interface ChargeRequest {
  reference: string;
  amountNaira: number;
  email: string;
  expiresAt: Date;
  metadata: Record<string, unknown>;
}

export type ChargeResult =
  | { ok: true; account: TransferAccount }
  | { ok: false; reason: 'duplicate_reference' | 'invalid_email' | 'paystack_error'; detail: string };

export interface Transaction {
  /** Paystack's status: success, ongoing, pending, failed, abandoned, reversed… */
  status: string;
  gatewayResponse: string;
  amountNaira: number;
  currency: string;
  paidAt: string | null;
  metadata: Record<string, unknown>;
}

export type VerifyResult =
  | { ok: true; transaction: Transaction }
  | { ok: false; reason: 'not_found' | 'paystack_error'; detail: string };

type PaystackReply = { ok: true; data: any } | { ok: false; code?: string; detail: string };

async function call(path: string, init: RequestInit = {}): Promise<PaystackReply> {
  // Read per call, not at module load, so a rotated key takes effect without a restart.
  const key = process.env.PAYSTACK_SECRET_KEY ?? '';
  if (!key) return { ok: false, detail: 'PAYSTACK_SECRET_KEY is not set' };
  if (!key.startsWith('sk_test_')) {
    return { ok: false, detail: 'Refusing to run with a live Paystack key: this exercise uses test mode only' };
  }

  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs()),
    });
    const body = (await response.json().catch(() => null)) as
      | { status?: boolean; message?: string; code?: string; data?: unknown }
      | null;
    if (!response.ok || !body?.status) {
      return { ok: false, code: body?.code, detail: body?.message ?? `HTTP ${response.status}` };
    }
    return { ok: true, data: body.data };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

const toNaira = (kobo: number) => kobo / 100;

export async function createTransferCharge(request: ChargeRequest): Promise<ChargeResult> {
  const reply = await call('/charge', {
    method: 'POST',
    body: JSON.stringify({
      email: request.email,
      amount: Math.round(request.amountNaira * 100),
      reference: request.reference,
      bank_transfer: { account_expires_at: request.expiresAt.toISOString() },
      metadata: request.metadata,
    }),
  });

  if (!reply.ok) {
    if (reply.code === 'duplicate_reference') {
      return { ok: false, reason: 'duplicate_reference', detail: reply.detail };
    }
    return { ok: false, reason: 'paystack_error', detail: reply.detail };
  }

  const d = reply.data;
  return {
    ok: true,
    account: {
      bank: d.bank?.name ?? '',
      accountNumber: d.account_number,
      accountName: d.account_name,
      amountNaira: toNaira(d.amount),
      expiresAt: d.account_expires_at,
    },
  };
}

/** Paystack returns metadata as an object, a JSON string, or "" depending on how it was set. */
function parseMetadata(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

export async function verifyTransaction(reference: string): Promise<VerifyResult> {
  const reply = await call(`/transaction/verify/${encodeURIComponent(reference)}`);
  if (!reply.ok) {
    const reason = reply.code === 'transaction_not_found' ? 'not_found' : 'paystack_error';
    return { ok: false, reason, detail: reply.detail };
  }

  const d = reply.data;
  return {
    ok: true,
    transaction: {
      status: d.status,
      gatewayResponse: d.gateway_response ?? '',
      amountNaira: toNaira(d.amount),
      currency: d.currency,
      paidAt: d.paid_at ?? null,
      metadata: parseMetadata(d.metadata),
    },
  };
}
