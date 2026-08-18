/**
 * Customer email validation (N-28).
 *
 * UddoktaPay's create-charge API requires a real `email` field. The brief is
 * explicit that we must never fabricate a placeholder, so checkout collects
 * one and validates it here before any provider call.
 *
 * Deliberately conservative rather than RFC-5322-complete: a single @, no
 * whitespace, a dotted domain, and length caps that match the column and the
 * provider's own limits. Anything exotic enough to fail this is also exotic
 * enough that the customer should retype it.
 */
export const MAX_EMAIL_LENGTH = 254;

const EMAIL_RE = /^[^\s@,;:<>"'\\]{1,64}@[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export type EmailResult = { ok: true; email: string } | { ok: false; reason: string };

export function normalizeEmail(raw: unknown): EmailResult {
  const value = (raw ?? '').toString().trim().toLowerCase();
  if (!value) return { ok: false, reason: 'Email is required.' };
  if (value.length > MAX_EMAIL_LENGTH) return { ok: false, reason: 'Email is too long.' };
  if (!EMAIL_RE.test(value)) return { ok: false, reason: 'Use a valid email address.' };
  // Guard against a domain whose TLD is numeric or single-character.
  const tld = value.slice(value.lastIndexOf('.') + 1);
  if (tld.length < 2 || /^\d+$/.test(tld)) return { ok: false, reason: 'Use a valid email address.' };
  return { ok: true, email: value };
}
