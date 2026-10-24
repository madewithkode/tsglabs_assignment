/**
 * Diagnostic logging helpers. They exist to answer one question from evidence rather than
 * guesswork: does the Chord teammate still have the ids a tool returned on an earlier message?
 * If every id a call uses was issued seconds earlier in the same turn, it does not.
 */

import { quoteIdFrom, type ToolContext } from './tools/context.js';

const EMAIL = /[^\s@"]+@([^\s@"]+)/g;
/** Seven or more digits, allowing a leading + and spaces/dashes: a phone number, not a house number. */
const PHONE = /\+?\d[\d\s-]{5,}\d/g;

function maskString(text: string): string {
  return text
    .replace(EMAIL, (_m, domain: string) => `***@${domain}`)
    .replace(PHONE, (m) => `***${m.replace(/\D/g, '').slice(-2)}`);
}

/**
 * Tool arguments safe to log: emails and phone numbers masked, everything else — including the
 * *shape* of each argument, which is what a schema rejection is about — left intact.
 */
export function maskContactDetails(value: unknown): unknown {
  if (typeof value === 'string') return maskString(value);
  if (Array.isArray(value)) return value.map(maskContactDetails);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskContactDetails(v)]));
  }
  return value;
}

/** Which store issued each kind of id argument. */
const ID_ARGUMENTS = {
  pickup_address_id: 'addresses',
  dropoff_address_id: 'addresses',
  quote_id: 'quotes',
  reference: 'quotes',
} as const;

/** e.g. "pickup_address_id=A76UJG issued 127s ago, quote_id=QZZZZZ unknown or expired". */
export function describeIdAges(args: Record<string, unknown>, ctx: ToolContext): string {
  return Object.entries(ID_ARGUMENTS)
    .filter(([name]) => typeof args[name] === 'string')
    .map(([name, store]) => {
      const id = args[name] as string;
      // A booking reference is its quote id with a prefix; look the quote up by the bare id.
      const age = ctx[store].ageMs(store === 'quotes' ? quoteIdFrom(id) : id);
      return age === undefined ? `${name}=${id} unknown or expired` : `${name}=${id} issued ${Math.round(age / 1000)}s ago`;
    })
    .join(', ');
}
