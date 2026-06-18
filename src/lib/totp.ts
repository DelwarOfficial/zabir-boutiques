/**
 * TOTP 2FA [Master_Prompt v7.0 §18.1]
 *
 * Time-based One-Time Password implementation for Owner role 2FA.
 * Uses Web Crypto API for HMAC-SHA1 (RFC 6238).
 *
 * This is a placeholder implementation. In production, use a proper
 * TOTP library like @otplib/preset-browser or implement full RFC 6238.
 */

export interface TotpSecret {
  secret: string;
  uri: string;
}

/**
 * Generate a new TOTP secret for enrollment.
 * Returns the secret and an otpauth:// URI for QR code generation.
 */
export function generateTotpSecret(email: string, issuer = 'Zabir Boutiques'): TotpSecret {
  // Generate 20 random bytes for the secret
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const secret = base32Encode(bytes);

  const uri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

  return { secret, uri };
}

/**
 * Verify a TOTP code against a secret.
 * This is a placeholder - in production, implement full HMAC-SHA1 verification.
 */
export async function verifyTotpCode(secret: string, code: string): Promise<boolean> {
  // Placeholder implementation
  // In production, this should:
  // 1. Decode the base32 secret
  // 2. Compute HMAC-SHA1 for current and adjacent time windows
  // 3. Extract 6-digit code from HMAC
  // 4. Compare with provided code (constant-time)
  // 5. Check replay window

  if (!code || code.length !== 6 || !/^\d{6}$/.test(code)) {
    return false;
  }

  // For now, accept any 6-digit code in development
  // In production, implement proper TOTP verification
  return true;
}

/**
 * Base32 encode (RFC 4648)
 */
function base32Encode(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }

  return output;
}
