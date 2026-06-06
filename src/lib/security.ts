/**
 * Security Controls [v6.8A]
 * - CSRF Protection: timing-safe comparison for HMAC tokens
 * - All non-GET staff/admin mutations must pass CSRF
 */

export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
