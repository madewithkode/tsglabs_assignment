import { describe, expect, it } from 'vitest';
import { maskContactDetails } from '../../src/utils/mask';

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
