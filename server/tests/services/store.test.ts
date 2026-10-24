import { describe, expect, it } from 'vitest';
import { createStore } from '../../src/services/store';

function clock(start = 0) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe('createStore', () => {
  it('returns a value by the short id it was stored under', () => {
    const store = createStore<string>({ prefix: 'Q', ttlMs: 1000 });
    const id = store.put('quote');
    expect(store.get(id)).toBe('quote');
  });

  it('issues short ids from an alphabet without look-alike characters', () => {
    const store = createStore<number>({ prefix: 'Q', ttlMs: 1000 });
    const ids = Array.from({ length: 200 }, (_, i) => store.put(i));
    for (const id of ids) expect(id).toMatch(/^Q[2-9A-HJ-NP-Z]{5}$/);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('finds an id however the model cased or padded it', () => {
    const store = createStore<string>({ prefix: 'A', ttlMs: 1000 });
    const id = store.put('address');
    expect(store.get(` ${id.toLowerCase()} `)).toBe('address');
  });

  it('forgets a value once its time to live has passed', () => {
    const c = clock();
    const store = createStore<string>({ prefix: 'Q', ttlMs: 1000, now: c.now });
    const id = store.put('quote');
    c.advance(999);
    expect(store.get(id)).toBe('quote');
    c.advance(2);
    expect(store.get(id)).toBeUndefined();
  });

  it('stores a value under a caller-chosen key for the given time', () => {
    const c = clock();
    const store = createStore<string>({ prefix: 'P', ttlMs: 1000, now: c.now });
    store.set('Q7K2M9', 'account', 5000);
    c.advance(4000);
    expect(store.get('q7k2m9')).toBe('account');
  });

  it('reports how long ago an id was issued', () => {
    const c = clock();
    const store = createStore<string>({ prefix: 'Q', ttlMs: 60_000, now: c.now });
    const id = store.put('quote');
    c.advance(2_500);
    expect(store.ageMs(id.toLowerCase())).toBe(2_500);
  });

  it('reports no age for an id that is unknown or expired', () => {
    const c = clock();
    const store = createStore<string>({ prefix: 'Q', ttlMs: 1000, now: c.now });
    const id = store.put('quote');
    c.advance(1001);
    expect(store.ageMs(id)).toBeUndefined();
    expect(store.ageMs('QNOPE1')).toBeUndefined();
  });

  it('returns undefined for an id it never issued', () => {
    const store = createStore<string>({ prefix: 'Q', ttlMs: 1000 });
    expect(store.get('QNOPE1')).toBeUndefined();
  });
});
