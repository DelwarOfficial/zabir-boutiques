import { describe, it, expect } from 'vitest';
import { formatLog } from '../src/lib/pii-scrubber';

describe('K-30: PII_KEYS covers additional identity fields', () => {
  it('redacts nid, national_id, passport, postal_code, full_name, dob, date_of_birth', () => {
    const line = formatLog({
      level: 'info',
      message: 'test',
      data: {
        nid: '1234567890',
        national_id: '1234567890',
        passport: 'AB1234567',
        postal_code: '1207',
        full_name: 'Jane Doe',
        dob: '1990-01-01',
        date_of_birth: '1990-01-01',
      },
    });
    const parsed = JSON.parse(line);
    for (const key of ['nid', 'national_id', 'passport', 'postal_code', 'full_name', 'dob', 'date_of_birth']) {
      expect(parsed.data[key]).toBe('[REDACTED]');
    }
  });

  it('deliberately does NOT redact bare "name" — used for non-PII admin audit fields (role/API-key names)', () => {
    const line = formatLog({ level: 'info', message: 'test', data: { name: 'inventory_manager' } });
    const parsed = JSON.parse(line);
    expect(parsed.data.name).toBe('inventory_manager');
  });
});
