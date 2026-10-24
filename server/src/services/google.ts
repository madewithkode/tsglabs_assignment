/**
 * The one way this server talks to Google Maps Platform. Never throws: a missing key, a refusal,
 * a timeout or a malformed reply all come back as `{ ok: false, detail }` carrying Google's own
 * words, because "PERMISSION_DENIED: Places API (New) has not been used…" is what someone debugging
 * a live agent needs to see — not a generic failure.
 */

const timeoutMs = () => Number(process.env.GOOGLE_TIMEOUT_MS || 5_000);

export type GoogleResult<T> = { ok: true; data: T } | { ok: false; detail: string };

export async function googlePost<T>(
  url: string,
  fieldMask: string,
  body: unknown,
): Promise<GoogleResult<T>> {
  // Read per call, not at module load, so a key rotated in the environment takes effect at once.
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return { ok: false, detail: 'GOOGLE_MAPS_API_KEY is not set' };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': key,
        'X-Goog-FieldMask': fieldMask,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs()),
    });
    const data = (await response.json().catch(() => null)) as
      | (T & { error?: { status?: string; message?: string } })
      | null;

    if (!response.ok || data?.error) {
      const error = data?.error;
      return {
        ok: false,
        detail: error ? `${error.status}: ${error.message}` : `HTTP ${response.status}`,
      };
    }
    if (data === null) return { ok: false, detail: 'Unreadable response from Google' };
    return { ok: true, data };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}
