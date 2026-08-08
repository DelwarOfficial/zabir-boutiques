import { describe, it, expect } from 'vitest';
import { formatLog } from '../src/lib/pii-scrubber';

describe('PII redaction (T-27)', () => {
  it('redacts a Bangladeshi phone number found in free text', () => {
    const line = formatLog({ level: 'info', message: 'Order placed by +8801712345678' });
    expect(line).not.toContain('1712345678');
    expect(line).toContain('[PHONE]');
  });

  it('redacts a phone number without the country code', () => {
    const line = formatLog({ level: 'info', message: 'Contact: 01812345678' });
    expect(line).not.toContain('1812345678');
    expect(line).toContain('[PHONE]');
  });

  it('redacts an email address found in free text', () => {
    const line = formatLog({ level: 'warn', message: 'Reply-to customer@example.com failed' });
    expect(line).not.toContain('customer@example.com');
    expect(line).toContain('[EMAIL]');
  });

  it('redacts known PII keys in structured data regardless of value shape', () => {
    const line = formatLog({
      level: 'error',
      message: 'checkout failed',
      data: { phone: '+8801712345678', address: 'House 12, Road 5, Dhaka', order_id: 'o1' },
    });
    const parsed = JSON.parse(line);
    expect(parsed.data.phone).toBe('[REDACTED]');
    expect(parsed.data.address).toBe('[REDACTED]');
    expect(parsed.data.order_id).toBe('o1'); // non-PII fields pass through
  });

  it('redacts PII keys nested inside objects and arrays', () => {
    const line = formatLog({
      level: 'error',
      message: 'batch failed',
      data: { customers: [{ email: 'a@x.com', name: 'A' }, { email: 'b@x.com', name: 'B' }] },
    });
    const parsed = JSON.parse(line);
    expect(parsed.data.customers[0].email).toBe('[REDACTED]');
    expect(parsed.data.customers[1].email).toBe('[REDACTED]');
  });

  it('does not redact non-PII numeric or boolean fields', () => {
    const line = formatLog({ level: 'info', message: 'ok', data: { total_paisa: 50000, ok: true } });
    const parsed = JSON.parse(line);
    expect(parsed.data.total_paisa).toBe(50000);
    expect(parsed.data.ok).toBe(true);
  });

  it('a card number embedded under a PII key is redacted even though the value itself is not phone/email-shaped', () => {
    const line = formatLog({ level: 'error', message: 'payment error', data: { card_number: '4111111111111111' } });
    const parsed = JSON.parse(line);
    expect(parsed.data.card_number).toBe('[REDACTED]');
  });
});
