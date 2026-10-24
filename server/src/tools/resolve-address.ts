/**
 * resolve_address: what the customer typed → a stored address id the quote tool can trust.
 *
 * The agent never handles coordinates. It passes ids this tool issued, so a model cannot invent,
 * round or swap a location between the address read back to the customer and the one priced.
 */

import { searchPlaces } from '../services/places.js';
import { HAND_OFF, ToolContext } from './context.js';

interface ResolvedOption {
  address_id: string;
  name: string;
  address: string;
}

export type ResolveAddressResult =
  | ({ status: 'ok'; next_step: string } & ResolvedOption)
  | { status: 'ambiguous'; options: ResolvedOption[]; next_step: string }
  | { status: 'not_found'; next_step: string }
  | { status: 'too_broad'; area: string; next_step: string }
  | { status: 'out_of_area'; found_in: string; next_step: string }
  | { status: 'provider_error'; detail: string; next_step: string };

/** Case and spacing don't make a different search. */
const searchKey = (query: string) => query.trim().replace(/\s+/g, ' ');

export async function resolveAddress(
  input: { query: string },
  ctx: ToolContext,
): Promise<ResolveAddressResult> {
  // The same words give the same place for 30 minutes. In the simulator the agent searches again
  // on later messages, and a fresh search let the pickup change under the customer ("Lagos House
  // Ikeja", then "Lagos State Secretariat") between the quote and the payment. It also saves Google calls.
  const key = searchKey(input.query);
  let result = ctx.searches.get(key);
  if (!result) {
    result = await searchPlaces(input.query);
    // A provider failure is retried next time, never remembered.
    if (result.status !== 'provider_error') ctx.searches.set(key, result);
  }

  switch (result.status) {
    case 'ok':
      return {
        status: 'ok',
        address_id: ctx.addresses.put(result.place),
        name: result.place.name,
        address: result.place.address,
        next_step:
          'Use this address_id for the quote. Read the resolved address back in plain words when you give the price.',
      };

    case 'ambiguous':
      return {
        status: 'ambiguous',
        options: result.candidates.map((place) => ({
          address_id: ctx.addresses.put(place),
          name: place.name,
          address: place.address,
        })),
        next_step:
          'Ask the customer which of these places they mean, numbered. Use the address_id of the one they pick. If none is right, ask for a street name or nearby landmark and search again.',
      };

    case 'not_found':
      return {
        status: 'not_found',
        next_step:
          'Ask the customer for a street name, estate or well-known landmark nearby (a bank, church, mall or bus stop), then search again with that.',
      };

    case 'too_broad':
      return {
        status: 'too_broad',
        area: result.name,
        next_step: `${result.name} is too big an area to price from. Ask the customer for the street, estate or a nearby landmark in ${result.name} (e.g. a bank, church, mall or bus stop), then search again with that.`,
      };

    case 'out_of_area':
      return {
        status: 'out_of_area',
        found_in: result.foundIn,
        next_step:
          'Tell the customer that place is outside our area: we only pick up and deliver within Lagos State. If they meant somewhere in Lagos, ask for more detail and search again.',
      };

    case 'provider_error':
      return { status: 'provider_error', detail: result.detail, next_step: HAND_OFF };
  }
}
