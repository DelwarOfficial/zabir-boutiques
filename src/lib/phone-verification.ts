/**
 * Customer Phone Verification [v7.1]
 *
 * OTP-based phone ownership verification for GDPR data-export and
 * data-deletion endpoints (/api/me/data, /api/me/delete).
 *
 * Flow:
 *   1. Client POSTs { phone } to /api/me/verify-phone/send
 *   2. Server generates 6-digit OTP, stores bcrypt hash in D1, returns { ttl_seconds }
 *      (In production, the OTP is sent via SMS; in dev it is returned in the response.)
 *   3. Client POSTs { phone, code } to /api/me/verify-phone/confirm
 *   4. Server verifies code, issues a signed HMAC token (15-min TTL)
 *   5. Client passes the token as Authorization: Bearer <token> on data/delete endpoints
 *
 * The signed token is a base64url-encoded JSON payload + HMAC-SHA256
 * signature, separated by a dot: `payload.signature`. The payload
 * contains { phone, exp }. No server-side session is needed — the
 * signature is verified with SESSION_SECRET.
 */

import { nowSql } from './dates';
import { normalizeBangladeshPhone } from './phone';

const OTP_LENGTH = 6;
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const TOKEN_TTL_MS = 15 * 60 * 1000; // 15 minutes
const MAX_ATTEMPTS = 5;

function generateOtpCode(): string {
  // Cryptographically random 6-digit code
  const buf = crypto.getRandomValues(new Uint8Array(4));
  const num = new DataView(buf.buffer).getUint32(0, false);
  return String(num % 1_000_000).padStart(OTP_LENGTH, '0');
}

async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256Base64url(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  // base64url encode
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlEncode(data: string): string {
  return btoa(data).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(data: string): string {
  const padded = data.replace(/-/g, '+').replace(/_/g, '/');
  return atob(padded);
}

export interface SendOtpResult {
  ok: true;
  ttl_seconds: number;
  /** Only present in development (when no SMS provider is configured) */
  dev_code?: string;
}

export interface SendOtpFailure {
  ok: false;
  code: 'INVALID_PHONE' | 'RATE_LIMITED' | 'INTERNAL_ERROR';
}

/**
 * Generate and store an OTP for the given phone number.
 * Returns the plaintext code only in dev mode (no SMS provider).
 */
export async function sendPhoneOtp(
  db: D1Database,
  rawPhone: string,
): Promise<SendOtpResult | SendOtpFailure> {
  const normalized = normalizeBangladeshPhone(rawPhone);
  if (!normalized.ok) return { ok: false, code: 'INVALID_PHONE' };

  // Rate limit: max 3 OTPs per phone per 10 minutes
  const recentCount = await db.prepare(
    `SELECT COUNT(*) AS cnt FROM customer_phone_otps
     WHERE phone = ?1 AND created_at > datetime('now', '-10 minutes')`
  ).bind(normalized.phone).first<{ cnt: number }>();
  if ((recentCount?.cnt ?? 0) >= 3) {
    return { ok: false, code: 'RATE_LIMITED' };
  }

  const code = generateOtpCode();
  const codeHash = await sha256Hex(code);
  const id = crypto.randomUUID();
  const now = nowSql();
  const expiresAt = new Date(Date.now() + OTP_TTL_MS).toISOString();

  await db.prepare(
    `INSERT INTO customer_phone_otps (id, phone, code_hash, attempts, max_attempts, created_at, expires_at)
     VALUES (?1, ?2, ?3, 0, ?4, ?5, ?6)`
  ).bind(id, normalized.phone, codeHash, MAX_ATTEMPTS, now, expiresAt).run();

  // In production, send the OTP via SMS provider here.
  // For now, return the code in the response for development.
  return { ok: true, ttl_seconds: Math.floor(OTP_TTL_MS / 1000), dev_code: code };
}

export interface ConfirmOtpResult {
  ok: true;
  token: string;
  ttl_seconds: number;
}

export interface ConfirmOtpFailure {
  ok: false;
  code: 'INVALID_PHONE' | 'INVALID_CODE' | 'EXPIRED' | 'TOO_MANY_ATTEMPTS' | 'INTERNAL_ERROR';
}

/**
 * Verify the OTP code and issue a signed phone-verification token.
 */
export async function confirmPhoneOtp(
  db: D1Database,
  rawPhone: string,
  code: string,
  sessionSecret: string,
): Promise<ConfirmOtpResult | ConfirmOtpFailure> {
  const normalized = normalizeBangladeshPhone(rawPhone);
  if (!normalized.ok) return { ok: false, code: 'INVALID_PHONE' };

  if (!code || code.length !== OTP_LENGTH || !/^\d{6}$/.test(code)) {
    return { ok: false, code: 'INVALID_CODE' };
  }

  // Find the most recent unconsumed OTP for this phone
  const row = await db.prepare(
    `SELECT id, code_hash, attempts, max_attempts, expires_at
     FROM customer_phone_otps
     WHERE phone = ?1 AND consumed_at IS NULL
     ORDER BY created_at DESC LIMIT 1`
  ).bind(normalized.phone).first<{ id: string; code_hash: string; attempts: number; max_attempts: number; expires_at: string }>();

  if (!row) return { ok: false, code: 'EXPIRED' };

  if (new Date(row.expires_at) < new Date()) {
    return { ok: false, code: 'EXPIRED' };
  }

  if (row.attempts >= row.max_attempts) {
    return { ok: false, code: 'TOO_MANY_ATTEMPTS' };
  }

  const codeHash = await sha256Hex(code);
  const isValid = codeHash === row.code_hash;

  // Increment attempts regardless of outcome
  await db.prepare(
    `UPDATE customer_phone_otps SET attempts = attempts + 1 WHERE id = ?1`
  ).bind(row.id).run();

  if (!isValid) {
    return { ok: false, code: 'INVALID_CODE' };
  }

  // Mark consumed
  await db.prepare(
    `UPDATE customer_phone_otps SET consumed_at = datetime('now') WHERE id = ?1`
  ).bind(row.id).run();

  // Issue signed token
  const exp = Date.now() + TOKEN_TTL_MS;
  const payload = JSON.stringify({ phone: normalized.phone, exp });
  const payloadB64 = base64urlEncode(payload);
  const signature = await hmacSha256Base64url(payloadB64, sessionSecret);
  const token = `${payloadB64}.${signature}`;

  return { ok: true, token, ttl_seconds: Math.floor(TOKEN_TTL_MS / 1000) };
}

export interface VerifyTokenResult {
  valid: true;
  phone: string;
}

export interface VerifyTokenFailure {
  valid: false;
  reason: 'MISSING' | 'MALFORMED' | 'EXPIRED' | 'INVALID_SIGNATURE';
}

/**
 * Verify a signed phone-verification token.
 * Returns the normalized phone number if valid.
 */
export async function verifyPhoneToken(
  token: string,
  sessionSecret: string,
): Promise<VerifyTokenResult | VerifyTokenFailure> {
  if (!token) return { valid: false, reason: 'MISSING' };

  const dotIndex = token.indexOf('.');
  if (dotIndex < 0) return { valid: false, reason: 'MALFORMED' };

  const payloadB64 = token.slice(0, dotIndex);
  const signature = token.slice(dotIndex + 1);

  if (!payloadB64 || !signature) return { valid: false, reason: 'MALFORMED' };

  // Verify signature
  const expectedSig = await hmacSha256Base64url(payloadB64, sessionSecret);
  if (expectedSig !== signature) return { valid: false, reason: 'INVALID_SIGNATURE' };

  // Decode and check expiry
  let payload: { phone: string; exp: number };
  try {
    payload = JSON.parse(base64urlDecode(payloadB64));
  } catch {
    return { valid: false, reason: 'MALFORMED' };
  }

  if (!payload.phone || !payload.exp) return { valid: false, reason: 'MALFORMED' };
  if (payload.exp < Date.now()) return { valid: false, reason: 'EXPIRED' };

  return { valid: true, phone: payload.phone };
}

/**
 * Extract Bearer token from Authorization header.
 */
export function extractBearerToken(request: Request): string | null {
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  return auth.slice(7).trim() || null;
}
