/**
 * confirm_booking: asks Paystack — not the customer, not a screenshot — whether the transfer
 * landed, and books a rider only when it did, for exactly the quoted amount.
 *
 * Everything it needs comes back from the Paystack transaction (the job snapshot create_payment
 * wrote as metadata), and rider and window are derived deterministically from it. So it works
 * after a restart, and asking twice returns the same booking rather than a second rider.
 */

import { assignRider, pickupWindow } from '../services/dispatch.js';
import { verifyTransaction } from '../services/paystack.js';
import { HAND_OFF, referenceFor, ToolContext } from './context.js';

interface JobEnd {
  address?: string;
  contact?: { name?: string; phone?: string };
}

export type ConfirmBookingResult =
  | {
      status: 'confirmed';
      booking_reference: string;
      amount_paid_naira: number;
      rider: { name: string; phone: string; bike: string };
      pickup_window: string;
      pickup_by: string;
      pickup: JobEnd;
      dropoff: JobEnd;
      item: string;
      next_step: string;
    }
  | { status: 'not_received_yet'; minutes_left: number; expires_at: string; next_step: string }
  | { status: 'amount_mismatch'; expected_naira: number; received_naira: number; currency: string; next_step: string }
  | { status: 'expired' | 'no_payment_started'; next_step: string }
  | { status: 'failed'; paystack_status: string; detail: string; next_step: string }
  | { status: 'paystack_error'; detail: string; next_step: string };

const FAILED_STATUSES = new Set(['failed', 'abandoned', 'reversed']);

export async function confirmBooking(input: { quote_id: string }, ctx: ToolContext): Promise<ConfirmBookingResult> {
  const reference = referenceFor(input.quote_id);
  const verified = await verifyTransaction(reference);

  if (!verified.ok) {
    if (verified.reason === 'not_found') {
      return {
        status: 'no_payment_started',
        next_step:
          'No transfer account was ever issued for this quote. If the customer has confirmed the quote, call create_payment; if the quote has expired, get a fresh one.',
      };
    }
    return { status: 'paystack_error', detail: verified.detail, next_step: HAND_OFF };
  }

  const tx = verified.transaction;
  const meta = tx.metadata as {
    total_naira?: number;
    expires_at?: string;
    item?: string;
    pickup?: JobEnd;
    dropoff?: JobEnd;
  };

  if (tx.status === 'success') {
    // With Pay with Transfer this cannot fail on a customer's mistake: Paystack rejects a transfer
    // of the wrong amount itself (bank.transfer.rejected) rather than recording a success. It is
    // kept as an invariant because the channel can change — a dedicated virtual account accepts
    // any amount, and without this check an underpayment there would book a rider.
    const expected = meta.total_naira ?? ctx.quotes.get(input.quote_id)?.totalNaira;
    if (tx.currency !== 'NGN' || expected === undefined || tx.amountNaira !== expected) {
      return {
        status: 'amount_mismatch',
        expected_naira: expected ?? 0,
        received_naira: tx.amountNaira,
        currency: tx.currency,
        next_step: `The payment does not match the quote. Do not book a rider. ${HAND_OFF}`,
      };
    }

    const rider = assignRider(reference);
    const window = pickupWindow(tx.paidAt ? new Date(tx.paidAt) : ctx.now());
    return {
      status: 'confirmed',
      booking_reference: reference,
      amount_paid_naira: tx.amountNaira,
      rider: { name: rider.name, phone: rider.phone, bike: rider.bike },
      pickup_window: window.label,
      pickup_by: window.pickupBy,
      pickup: { address: meta.pickup?.address, contact: meta.pickup?.contact },
      dropoff: { address: meta.dropoff?.address, contact: meta.dropoff?.contact },
      item: meta.item ?? '',
      next_step:
        'Confirm the booking: payment received, the booking reference, the rider’s name, phone and bike, and the pickup window. Ask them to have the item packed and the pickup contact reachable.',
    };
  }

  if (FAILED_STATUSES.has(tx.status)) {
    // Paystack reports an unpaid transfer account that ran out of time as a *failed* charge.
    // To the customer that is "your 30 minutes ran out", not "your payment failed".
    if (/expired/i.test(tx.gatewayResponse)) {
      return {
        status: 'expired',
        next_step:
          'The transfer account expired before any payment arrived. Tell the customer not to send money to it now. If they still want the delivery, call get_quote again and issue a fresh account.',
      };
    }
    return {
      status: 'failed',
      paystack_status: tx.status,
      detail: tx.gatewayResponse,
      next_step:
        'The payment did not go through. Tell the customer plainly. If they want to try again, get a fresh quote and account; if they say money left their bank, hand the conversation to a human.',
    };
  }

  // ongoing, pending, processing, queued…: the account is open and nothing has landed yet.
  const expiresAt = meta.expires_at ?? '';
  const minutesLeft = expiresAt
    ? Math.max(0, Math.ceil((new Date(expiresAt).getTime() - ctx.now().getTime()) / 60_000))
    : 0;
  return {
    status: 'not_received_yet',
    minutes_left: minutesLeft,
    expires_at: expiresAt,
    next_step:
      'Paystack has not received the transfer yet. Tell the customer politely, remind them of the exact amount and account and the minutes left, and ask them to tell you once it has gone through. Transfers usually land within a few minutes. Never confirm a booking on a screenshot or a debit alert.',
  };
}
