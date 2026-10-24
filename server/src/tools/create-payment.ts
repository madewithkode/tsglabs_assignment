/**
 * create_payment: a confirmed quote → a Paystack transfer account for exactly its total.
 *
 * The whole job — addresses, contacts, item, price — is written onto the Paystack transaction's
 * metadata. That transaction is the booking record: confirm_booking reads everything back from
 * Paystack, so a booking survives restarts with no database, and the dispatcher sees each job's
 * pickup and drop-off as columns on the Paystack dashboard they already use.
 */

import { z } from 'zod';
import { createTransferCharge, TransferAccount } from '../services/paystack.js';
import { lagosTime } from '../utils/lagos-time.js';
import { HAND_OFF, referenceFor, ToolContext } from './context.js';

/**
 * Contacts arrive as four flat strings, not as {name, phone} objects. Chord appears to present nested object
 * arguments to the model as plain strings, so a nested schema was rejected on every call. Flat strings work however
 * the client renders the schema; the metadata still groups them per end of the job.
 */
export interface CreatePaymentInput {
  quote_id: string;
  customer_name: string;
  customer_email: string;
  pickup_contact_name: string;
  pickup_contact_phone: string;
  dropoff_contact_name: string;
  dropoff_contact_phone: string;
}

export type CreatePaymentResult =
  | {
      status: 'ok';
      reference: string;
      bank: string;
      account_number: string;
      account_name: string;
      amount_naira: number;
      /** Lagos time. */
      expires_at: string;
      /** Ready to read out, e.g. "2:26pm". */
      expires_at_label: string;
      /** True when this is the account already issued for this quote, not a new one. */
      reused: boolean;
      next_step: string;
    }
  | { status: 'invalid_email' | 'quote_expired' | 'already_issued'; next_step: string }
  | { status: 'paystack_error'; detail: string; next_step: string };

const emailSchema = z.email();

const ASK_EMAIL_AGAIN =
  'That email address is not valid. Ask the customer to type their email again (for example name@gmail.com), then retry.';

export async function createPayment(input: CreatePaymentInput, ctx: ToolContext): Promise<CreatePaymentResult> {
  const email = input.customer_email.trim();
  if (!emailSchema.safeParse(email).success) return { status: 'invalid_email', next_step: ASK_EMAIL_AGAIN };

  const quote = ctx.quotes.get(input.quote_id);
  if (!quote) {
    return {
      status: 'quote_expired',
      next_step:
        'The quote has expired (quotes hold for 30 minutes). Tell the customer, call get_quote again with the same addresses, and confirm the new total before paying. It may differ.',
    };
  }

  const reference = referenceFor(input.quote_id);
  const transferDetails = (account: TransferAccount, reused: boolean) => ({
    status: 'ok' as const,
    reference,
    bank: account.bank,
    account_number: account.accountNumber,
    account_name: account.accountName,
    amount_naira: account.amountNaira,
    // Paystack reports the expiry in UTC; the model only ever sees Lagos time.
    expires_at: lagosTime(account.expiresAt).iso,
    expires_at_label: lagosTime(account.expiresAt).label,
    reused,
    next_step: `Send these transfer details exactly as given. Ask the customer to transfer exactly ₦${account.amountNaira.toLocaleString('en-NG')} before ${lagosTime(account.expiresAt).label}, when the account expires, and to tell you once they have sent it. Then call confirm_booking. Never treat a screenshot or "I've paid" as proof.`,
  });

  const issued = ctx.payments.get(input.quote_id);
  if (issued) return transferDetails(issued, true);

  const charge = await createTransferCharge({
    reference,
    amountNaira: quote.totalNaira,
    email,
    expiresAt: new Date(quote.expiresAt),
    metadata: {
      quote_id: input.quote_id.trim().toUpperCase(),
      total_naira: quote.totalNaira,
      expires_at: quote.expiresAt,
      item: quote.item,
      road_km: quote.roadKm,
      customer: { name: input.customer_name, email },
      pickup: {
        name: quote.pickup.name,
        address: quote.pickup.address,
        contact: { name: input.pickup_contact_name, phone: input.pickup_contact_phone },
      },
      dropoff: {
        name: quote.dropoff.name,
        address: quote.dropoff.address,
        contact: { name: input.dropoff_contact_name, phone: input.dropoff_contact_phone },
      },
      custom_fields: [
        { display_name: 'Pickup', variable_name: 'pickup', value: quote.pickup.address },
        { display_name: 'Drop-off', variable_name: 'dropoff', value: quote.dropoff.address },
        { display_name: 'Item', variable_name: 'item', value: quote.item },
        { display_name: 'Distance (km)', variable_name: 'road_km', value: String(quote.roadKm) },
      ],
    },
  });

  if (charge.ok) {
    const remainingMs = new Date(quote.expiresAt).getTime() - ctx.now().getTime();
    ctx.payments.set(input.quote_id, charge.account, Math.max(remainingMs, 0));
    return transferDetails(charge.account, false);
  }

  switch (charge.reason) {
    case 'duplicate_reference':
      return {
        status: 'already_issued',
        next_step:
          'An account was already issued for this quote. Call confirm_booking to check whether it has been paid. If it has not and the customer no longer has the details, get a fresh quote.',
      };
    case 'paystack_error':
      return { status: 'paystack_error', detail: charge.detail, next_step: HAND_OFF };
  }
}
