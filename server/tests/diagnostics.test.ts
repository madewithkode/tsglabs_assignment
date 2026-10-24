import { describe, expect, it } from 'vitest';
import { describeIdAges, maskContactDetails } from '../src/diagnostics';
import { createContext } from '../src/tools/context';

describe('maskContactDetails', () => {
  it('masks emails and phone numbers but keeps the shape of the arguments', () => {
    expect(
      maskContactDetails({
        customer_email: 'princekelvin91@gmail.com',
        pickup_contact: { name: 'Ada', phone: '08166879424' },
        quote_id: 'QYX393',
      }),
    ).toEqual({
      customer_email: '***@gmail.com',
      pickup_contact: { name: 'Ada', phone: '***24' },
      quote_id: 'QYX393',
    });
  });

  it('masks details inside a contact sent as one string, so a wrong shape is still visible', () => {
    expect(maskContactDetails({ pickup_contact: 'Princewill Onyenanu, 08166879424' })).toEqual({
      pickup_contact: 'Princewill Onyenanu, ***24',
    });
  });

  it('leaves short numbers such as house numbers alone', () => {
    expect(maskContactDetails({ query: '42 Local Airport Rd, Ikeja' })).toEqual({ query: '42 Local Airport Rd, Ikeja' });
  });
});

describe('describeIdAges', () => {
  it('says how long ago each referenced address or quote id was issued', () => {
    let now = 0;
    const ctx = createContext(() => new Date(now));
    const pickup = ctx.addresses.put({ name: 'A', address: 'A', location: { latitude: 0, longitude: 0 } });
    now = 125_000;
    const dropoff = ctx.addresses.put({ name: 'B', address: 'B', location: { latitude: 0, longitude: 0 } });
    now = 127_000;

    expect(describeIdAges({ pickup_address_id: pickup, dropoff_address_id: dropoff }, ctx)).toBe(
      `pickup_address_id=${pickup} issued 127s ago, dropoff_address_id=${dropoff} issued 2s ago`,
    );
  });

  it('flags an id the server never issued or has forgotten', () => {
    expect(describeIdAges({ quote_id: 'QZZZZZ' }, createContext())).toBe('quote_id=QZZZZZ unknown or expired');
  });

  it('returns nothing for a call that references no ids', () => {
    expect(describeIdAges({ query: 'Yaba' }, createContext())).toBe('');
  });
});
