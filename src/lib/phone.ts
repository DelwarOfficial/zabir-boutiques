/**
 * Bangladesh Phone Normalization [Task 3 Remediation]
 * Uses libphonenumber-js for E.164 (+880) canonical format.
 * Stored: +8801XXXXXXXXX
 * Local: 01XXXXXXXXX
 */
import { parsePhoneNumberFromString } from 'libphonenumber-js';

export type PhoneNormalizeResult =
  | { ok: true; phone: string; local: string }
  | { ok: false; reason: 'EMPTY' | 'INVALID_BD_MOBILE' };

export function normalizeBangladeshPhone(input: string): PhoneNormalizeResult {
  const raw = String(input ?? '').trim();
  if (!raw) {
    return { ok: false, reason: 'EMPTY' };
  }

  // Try with BD region first, then as international.
  let phoneNumber = parsePhoneNumberFromString(raw, 'BD');
  if (!phoneNumber || !phoneNumber.isValid()) {
    phoneNumber = parsePhoneNumberFromString(raw);
  }

  if (!phoneNumber || !phoneNumber.isValid()) {
    return { ok: false, reason: 'INVALID_BD_MOBILE' };
  }

  // Force BD numbers to +880...
  const cc = phoneNumber.countryCallingCode;
  if (cc !== '880') {
    // Only accept Bangladeshi numbers per business rules.
    return { ok: false, reason: 'INVALID_BD_MOBILE' };
  }

  const e164 = phoneNumber.format('E.164'); // +8801...
  const local = '0' + phoneNumber.nationalNumber; // 01...

  // Additional BD mobile pattern guard (13xx-19xx)
  if (!/^01[3-9]\d{8}$/.test(local)) {
    return { ok: false, reason: 'INVALID_BD_MOBILE' };
  }

  return { ok: true, phone: e164, local };
}

export function phoneHelperText(input: string) {
  const result = normalizeBangladeshPhone(input);
  if (!input.trim()) return 'Example: 017XXXXXXXX';
  if (result.ok) return `Valid number: ${result.phone}`;
  return 'Use 013-019 Bangladeshi mobile numbers only.';
}
