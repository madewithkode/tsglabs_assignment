/**
 * Masks contact details for logging. Used on the `[mcp] call` line, which records every tool
 * call's arguments before the MCP library validates them: a call rejected against the input
 * schema never reaches a tool, so that line is the only record of what the model actually sent.
 */

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
