/**
 * Bangladesh Phone Normalization [v6.8A]
 * Canonical stored format: +8801XXXXXXXXX
 * Local validation format: 01XXXXXXXXX
 * All regex anchors use real ASCII caret (U+005E).
 */
export type PhoneNormalizeResult =
  | { ok: true; phone: string; local: string }
  | { ok: false; reason: 'EMPTY' | 'INVALID_BD_MOBILE' };

const PHONE_PATTERN = new RegExp('^01[3-9]\\d{8}$');

export function normalizeBangladeshPhone(input: string): PhoneNormalizeResult {
  const stripped = String(input ?? '').replace(/\D/g, '');
  let local: string;

  if (!stripped) {
    return { ok: false, reason: 'EMPTY' };
  }

  if (stripped.length === 13 && stripped.startsWith('880')) {
    local = '0' + stripped.slice(3);
  } else if (stripped.length === 11 && stripped.startsWith('0')) {
    local = stripped;
  } else if (stripped.length === 10 && stripped.startsWith('1')) {
    local = '0' + stripped;
  } else {
    return { ok: false, reason: 'INVALID_BD_MOBILE' };
  }

  if (!PHONE_PATTERN.test(local)) {
    return { ok: false, reason: 'INVALID_BD_MOBILE' };
  }

  return { ok: true, local, phone: '+88' + local };
}

export function phoneHelperText(input: string) {
  const result = normalizeBangladeshPhone(input);
  if (!input.trim()) return 'Example: 017XXXXXXXX';
  if (result.ok) return `Valid number: ${result.phone}`;
  return 'Use 013-019 Bangladeshi mobile numbers only.';
}
