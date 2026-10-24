/**
 * Registers the four tools on an MCP server. Descriptions are written for the model: they say
 * when to call each tool and in what order, because Chord shows them to the teammate verbatim.
 *
 * Inputs are deliberately loose strings. Validation that the customer must act on (a malformed
 * email, an expired quote) is done inside the tools and returned as a status with a next_step —
 * a schema rejection would surface to the agent as an opaque protocol error instead.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { describeIdAges } from './diagnostics.js';
import { confirmBooking } from './tools/confirm-booking.js';
import { ToolContext } from './tools/context.js';
import { createPayment } from './tools/create-payment.js';
import { getQuote } from './tools/get-quote.js';
import { resolveAddress } from './tools/resolve-address.js';

/** The two fields every tool result shares and the call log reads. */
type ToolResult = { status: string; detail?: string };

/** Header names worth seeing when checking what context Chord sends; values of secrets are not. */
const redact = (headers: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k, /authorization|api-key|cookie/i.test(k) ? '[redacted]' : v]),
  );

export function buildServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: 'swiftbox-dispatch', version: '1.0.0' });

  /** Runs a tool, logs one line per call, and wraps the result as MCP text content. */
  const run =
    <I>(name: string, handler: (input: I, ctx: ToolContext) => Promise<ToolResult>) =>
    async (input: I, extra: { requestInfo?: { headers: Record<string, unknown> }; _meta?: unknown }) => {
      // The Chord docs don't exactly say whether a tool call carries any thread or sender context we
      // should look out for so we log the entire thing. Sensitive headers are redacted.
      if (process.env.LOG_REQUEST_CONTEXT === '1') {
        console.log(
          `[mcp] ${name} context`,
          JSON.stringify({ headers: redact(extra.requestInfo?.headers ?? {}), _meta: extra._meta ?? null }),
        );
      }
      // Measured before the handler runs, so ids it issues itself can't be mistaken for inputs.
      const ids = describeIdAges(input as Record<string, unknown>, ctx);
      const started = Date.now();
      try {
        const result = await handler(input, ctx);
        const detail = result.detail ? ` — ${result.detail}` : '';
        console.log(`[mcp] ${name} → ${result.status} (${Date.now() - started}ms)${detail}${ids ? ` [${ids}]` : ''}`);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] };
      } catch (error) {
        // Tools are written never to throw; reaching this is a bug, and the agent must not guess.
        console.error(`[mcp] ${name} threw`, error);
        return {
          isError: true,
          content: [{ type: 'text' as const, text: JSON.stringify({ status: 'internal_error', next_step: 'Hand the conversation to a human dispatcher.' }) }],
        };
      }
    };

  server.registerTool(
    'resolve_address',
    {
      title: 'Resolve an address',
      description:
        'Turn a pickup or drop-off location the customer typed (street, estate or landmark, e.g. "Shoprite Lekki" or "12 Herbert Macaulay Way, Yaba") into an address_id. Call once for the pickup and once for the drop-off, before get_quote. Returns status ok (with address_id), ambiguous (options to offer the customer), too_broad (a whole district like "Lekki": ask for a street or landmark), not_found, out_of_area (outside Lagos) or provider_error. Always follow next_step.',
      inputSchema: { query: z.string().describe('The location exactly as the customer described it, plus area if known') },
    },
    run('resolve_address', resolveAddress),
  );

  server.registerTool(
    'get_quote',
    {
      title: 'Quote a delivery',
      description:
        'Price a bike delivery between two resolved addresses by road distance. This is the ONLY source of prices: never state, estimate or adjust a price yourself. Returns a quote_id valid for 30 minutes with the total in naira, or out_of_range / same_place / unknown_address_id / provider_error. Always follow next_step.',
      inputSchema: {
        pickup_address_id: z.string().describe('address_id from resolve_address for the pickup'),
        dropoff_address_id: z.string().describe('address_id from resolve_address for the drop-off'),
        item_description: z.string().describe('What is being sent, as the customer described it'),
      },
    },
    run('get_quote', getQuote),
  );

  server.registerTool(
    'create_payment',
    {
      title: 'Issue transfer details',
      description:
        'After the customer has accepted a quote and given their name and email, issue a Paystack bank-transfer account for exactly the quoted total. Calling it again for the same quote returns the same account. Returns the bank, account number, account name, amount and expiry, or invalid_email / quote_expired / already_issued / paystack_error. Always follow next_step.',
      inputSchema: {
        quote_id: z.string().describe('quote_id from get_quote'),
        customer_name: z.string().describe('The customer’s full name'),
        customer_email: z.string().describe('The customer’s email address, checked to look valid'),
        // Flat strings on purpose: Chord shows nested object arguments to the model as plain
        // strings, so a {name, phone} object was rejected on every call (see create-payment.ts).
        pickup_contact_name: z.string().describe('Full name of the person who hands the item to the rider'),
        pickup_contact_phone: z.string().describe('Phone number of the pickup contact, as the customer gave it'),
        dropoff_contact_name: z.string().describe('Full name of the person who receives the item'),
        dropoff_contact_phone: z.string().describe('Phone number of the drop-off contact, as the customer gave it'),
      },
    },
    run('create_payment', createPayment),
  );

  server.registerTool(
    'confirm_booking',
    {
      title: 'Confirm payment and book a rider',
      description:
        'Check with Paystack whether the transfer for a booking has arrived and, only if the exact amount landed, book a rider. Call it whenever the customer says they have paid — never treat their word, a screenshot or a debit alert as proof. Safe to call repeatedly. Returns confirmed (rider and pickup window), not_received_yet, expired, failed, amount_mismatch, no_payment_started or paystack_error. Always follow next_step.',
      inputSchema: {
        reference: z.string().describe('The booking reference create_payment returned and the customer was shown, e.g. SWB-Q7K2M9'),
      },
    },
    run('confirm_booking', confirmBooking),
  );

  return server;
}
