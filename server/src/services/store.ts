/**
 * In-memory store with a time to live, for state that is meant to be short-lived: resolved
 * addresses and quotes (30 minutes). Losing it on a restart — or when Render's free tier puts the
 * server to sleep — costs one re-quote, which the agent already handles, so a database would buy
 * nothing. Bookings never live here; their record is the Paystack transaction.
 */

import { randomInt } from 'node:crypto';

/** No 0/O, 1/I/L: an LLM copying the id back, or a customer reading it, cannot confuse them. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const ID_BODY_LENGTH = 5;

export interface TtlStore<T> {
  /** Stores a value under a fresh short id and returns the id. */
  put(value: T): string;
  /** Stores a value under a key the caller chose, e.g. the quote id a payment belongs to. */
  set(key: string, value: T, ttlMs?: number): void;
  /** The live value, or undefined when it never existed or has expired. */
  get(id: string): T | undefined;
}

interface Options {
  prefix: string;
  ttlMs: number;
  now?: () => number;
}

/** Ids reach us through a model: forgive case and stray whitespace. */
const normalize = (id: string) => id.trim().toUpperCase();

export function createStore<T>({ prefix, ttlMs, now = Date.now }: Options): TtlStore<T> {
  const entries = new Map<string, { value: T; expiresAt: number }>();

  const sweep = () => {
    const t = now();
    for (const [key, entry] of entries) if (entry.expiresAt <= t) entries.delete(key);
  };

  const freshId = () => {
    let id: string;
    do {
      id = prefix;
      for (let i = 0; i < ID_BODY_LENGTH; i++) id += ALPHABET[randomInt(ALPHABET.length)];
    } while (entries.has(id));
    return id;
  };

  /** The entry behind an id while it is live; drops it once expired. */
  const live = (id: string) => {
    const key = normalize(id);
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now()) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  };

  return {
    put(value) {
      sweep();
      const id = freshId();
      entries.set(id, { value, expiresAt: now() + ttlMs });
      return id;
    },
    set(key, value, customTtlMs = ttlMs) {
      entries.set(normalize(key), { value, expiresAt: now() + customTtlMs });
    },
    get(id) {
      return live(id)?.value;
    },
  };
}
