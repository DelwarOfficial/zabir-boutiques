/**
 * TOTP 2FA [Master_Prompt v7.0 §18.1]
 *
 * Time-based One-Time Password implementation for Owner role 2FA.
 * Uses Web Crypto API for HMAC-SHA1 (RFC 6238).
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
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const secret = base32Encode(bytes);

  const uri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(email)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

  return { secret, uri };
}

/**
 * Verify a TOTP code against a secret using HMAC-SHA1 (RFC 6238).
 * Checks current time step and ±1 step window for clock drift tolerance.
 * Uses constant-time comparison to prevent timing attacks.
 */
export async function verifyTotpCode(secret: string, code: string): Promise<boolean> {
  if (!code || code.length !== 6 || !/^\d{6}$/.test(code)) {
    return false;
  }

  const keyBytes = base32Decode(secret);
  if (!keyBytes || keyBytes.length === 0) return false;

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer,
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );

  // Current 30-second time step
  const timeStep = Math.floor(Date.now() / 1000 / 30);

  // Check current and ±1 step for clock drift tolerance
  for (const offset of [0, -1, 1]) {
    const counter = timeStep + offset;
    const expected = await generateHotp(cryptoKey, counter);
    if (constantTimeEqual(code, expected)) {
      return true;
    }
  }

  return false;
}

/**
 * Generate HOTP code from HMAC key and counter (RFC 4226).
 */
async function generateHotp(key: CryptoKey, counter: number): Promise<string> {
  // Convert counter to 8-byte big-endian
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setUint32(0, Math.floor(counter / 0x100000000));
  view.setUint32(4, counter >>> 0);

  const hmac = await crypto.subtle.sign('HMAC', key, buffer);
  const hmacBytes = new Uint8Array(hmac);

  // Dynamic truncation (RFC 4226 §5.4)
  const offset = hmacBytes[hmacBytes.length - 1] & 0x0f;
  const binary =
    ((hmacBytes[offset] & 0x7f) << 24) |
    ((hmacBytes[offset + 1] & 0xff) << 16) |
    ((hmacBytes[offset + 2] & 0xff) << 8) |
    (hmacBytes[offset + 3] & 0xff);

  const otp = binary % 1_000_000;
  return otp.toString().padStart(6, '0');
}

/**
 * Constant-time string comparison to prevent timing attacks.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Base32 decode (RFC 4648)
 */
function base32Decode(input: string): Uint8Array | null {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const cleaned = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  if (cleaned.length === 0) return null;

  const byteLength = Math.floor(cleaned.length * 5 / 8);
  const bytes = new Uint8Array(byteLength);

  let bits = 0;
  let value = 0;
  let index = 0;

  for (const char of cleaned) {
    const charIndex = alphabet.indexOf(char);
    if (charIndex === -1) return null;

    value = (value << 5) | charIndex;
    bits += 5;

    if (bits >= 8) {
      bytes[index++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }

  return bytes.slice(0, byteLength);
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
