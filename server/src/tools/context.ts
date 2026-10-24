/**
 * What the four tools share: the short-lived stores and a clock. Built once per process in
 * index.ts and handed to every tool, so tests can give each case fresh stores and a fixed time.
 */

import { QUOTE_TTL_MINUTES } from '../config.js';
import type { Place } from '../services/places.js';
import type { PriceBreakdown } from '../services/pricing.js';
import type { TransferAccount } from '../services/paystack.js';
import { createStore, TtlStore } from '../services/store.js';

/** Stored under its short quote id; every caller already holds the id, so it is not repeated here. */
export interface Quote {
  pickup: Place;
  dropoff: Place;
  item: string;
  roadKm: number;
  breakdown: PriceBreakdown;
  totalNaira: number;
  expiresAt: string;
}

export interface ToolContext {
  addresses: TtlStore<Place>;
  quotes: TtlStore<Quote>;
  /** Transfer accounts already issued, keyed by quote id, so a repeat call returns the same one. */
  payments: TtlStore<TransferAccount>;
  now: () => Date;
}

export const QUOTE_TTL_MS = QUOTE_TTL_MINUTES * 60_000;

export function createContext(now: () => Date = () => new Date()): ToolContext {
  const clock = () => now().getTime();
  return {
    addresses: createStore<Place>({ prefix: 'A', ttlMs: QUOTE_TTL_MS, now: clock }),
    quotes: createStore<Quote>({ prefix: 'Q', ttlMs: QUOTE_TTL_MS, now: clock }),
    payments: createStore<TransferAccount>({ prefix: 'P', ttlMs: QUOTE_TTL_MS, now: clock }),
    now,
  };
}

/** Every booking's Paystack reference is derived from its quote, so either finds the other. */
export const referenceFor = (quoteId: string) => `SWB-${quoteId.trim().toUpperCase()}`;

/** Where the agent hands over to a person. Kept identical everywhere so the skill can key on it. */
export const HAND_OFF =
  'Do not guess or offer a price. Apologise briefly, tell the customer a dispatcher will take over, and hand the conversation to a human by calling handover_to_human with a one-line reason.';
