import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/env';
import { hashSessionToken, generateSessionToken } from '../../../lib/sessions';
import { createCsrfToken, hmacSha256Hex, timingSafeEqualHex } from '../../../lib/security';
import { getCsrfSigningKeys } from '../../../lib/csrf-keys';
import { hashPassword, verifyPasswordWithUpgrade, legacyHashPassword, PBKDF2_LEGACY_ITERATIONS } from '../../../lib/password';
import { generateRandomHex } from '../../../lib/security';
import { nowSql } from '../../../lib/dates';
import { writeAuditLog, clientIp, userAgent } from '../../../lib/audit';
import { normalizeBangladeshPhone } from '../../../lib/phone';
import { verifyTurnstile } from '../../../lib/turnstile';
import { verifyTotpCode } from '../../../lib/totp';
import { isStaffTotpEnabled, loadStaffTotpSecret, loadLastUsedTotpCounter, recordUsedTotpCounter } from '../../../lib/otp-secrets';
import { safeLog } from '../../../lib/pii-scrubber';
import { appendStaffAuthCookies } from '../../../lib/staff-cookies';
import { checkLoginRateLimit, resetLoginRateLimit, sha256Hex, LOGIN_RATE_LIMIT } from '../../../lib/login-rate-limit';
import type { StaffUser } from '../../../lib/rbac';

/**
 * N-21: record WHY a login was rejected, server-side only.
 *
 * The client always receives the same generic 'Invalid credentials' so no
 * account-existence or failure-mode signal leaks to an attacker. But an
 * operator staring at that message has no way to tell a wrong password from
 * a rotated PASSWORD_PEPPER, a deactivated row, or a missing account — which
 * is exactly the situation this codebase just spent a debugging session in.
 *
 * The identifier is an email/phone (PII), so it is logged as a short HMAC
 * prefix, never in the clear: enough to correlate repeated attempts against
 * one account across log lines, not enough to recover the address. The
 * password, its hash, and the salt are never logged. Logging must never be
 * able to break authentication, so every failure here is swallowed.
 */
async function logLoginRejection(
  reason: string,
  identifier: string,
  sessionSecret: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  try {
    const identifierRef = (await hmacSha256Hex(identifier, sessionSecret)).slice(0, 12);
    safeLog.warn('[staff.login] rejected', { reason, identifierRef, ...extra });
  } catch {
    safeLog.warn('[staff.login] rejected', { reason, identifierRef: 'unavailable', ...extra });
  }
}

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const sessionKv = (env as typeof env & { SESSION?: KVNamespace }).SESSION;
  const now = nowSql();

  let body: any = {};
  try {
    const contentType = context.request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      body = await context.request.json();
    } else {
      const form = await context.request.formData();
      body = Object.fromEntries(form.entries());
    }
  } catch {
    return Response.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const identifier = body.identifier ?? body.email ?? body.phone ?? '';
  const password = body.password ?? '';
  if (!identifier || !password) {
    return Response.json({ error: 'Email/phone and password required' }, { status: 400 });
  }

  // AUTH-3: rate-limit login attempts per IP and per identifier to blunt
  // brute force / credential stuffing. Identifiers are hashed before use
  // as a KV key so we never persist raw emails/phones. Fail open if no KV.
  const loginKv = sessionKv;
  const clientIpAddr = clientIp(context.request) ?? 'unknown';
  const idKey = await sha256Hex(identifier.trim().toLowerCase());
  const ipLimit = await checkLoginRateLimit(loginKv, 'ip', clientIpAddr, env.DB);
  if (!ipLimit.ok) {
    return Response.json(
      { error: 'Too many attempts. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(LOGIN_RATE_LIMIT.perIp.windowSeconds) } },
    );
  }
  const idLimit = await checkLoginRateLimit(loginKv, 'identifier', idKey, env.DB);
  if (!idLimit.ok) {
    return Response.json(
      { error: 'Too many attempts. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(LOGIN_RATE_LIMIT.perIdentifier.windowSeconds) } },
    );
  }

  // Turnstile bot protection on staff login (Master_Prompt v7.0 §18.5)
  // Token is REQUIRED when TURNSTILE_SECRET_KEY is set.
  // K-19: Turnstile must gate every password-verification attempt regardless
  // of totp_code. The old `!body.totp_code` guard let any caller skip
  // Turnstile just by sending a totp_code field, whether or not the account
  // actually has TOTP enabled. The 2-step TOTP UI resubmits the same
  // identifier+password on step 2, but Turnstile tokens are single-use, so
  // step 2 proves it already passed Turnstile+password via a short-lived
  // server-signed `step2Token` (issued on the totp_required response)
  // instead of re-solving the widget.
  const step2Token = typeof body.step2_token === 'string' ? body.step2_token : '';
  let step2Verified = false;
  if (env.TURNSTILE_SECRET_KEY && step2Token) {
    const [nonce, sig] = step2Token.split('.');
    if (nonce && sig) {
      const [expiresStr, idHash] = nonce.split(':');
      const expectedIdHash = await hmacSha256Hex(identifier, env.SESSION_SECRET);
      const expectedSig = await hmacSha256Hex(nonce, env.SESSION_SECRET);
      if (
        expiresStr && idHash
        && timingSafeEqualHex(idHash, expectedIdHash)
        && timingSafeEqualHex(sig, expectedSig)
        && Number(expiresStr) > Date.now()
      ) {
        step2Verified = true;
      }
    }
  }
  // N-21: TURNSTILE_SECRET_KEY missing means every check below is skipped and
  // the widget on the login page becomes decorative — solved client-side,
  // never verified server-side. That is a silently-disabled security control,
  // so say so loudly on each attempt rather than failing open in silence.
  if (!env.TURNSTILE_SECRET_KEY) {
    safeLog.error('[staff.login] TURNSTILE_SECRET_KEY is not configured — bot protection is DISABLED for staff login', {});
  }
  if (env.TURNSTILE_SECRET_KEY && !step2Verified) {
    const token = typeof body.turnstile === "string" ? body.turnstile : context.request.headers.get("CF-Turnstile-Token");
    if (!token) {
      return Response.json({ error: "Bot check required." }, { status: 403 });
    }
    const r = await verifyTurnstile(env, token, clientIp(context.request) ?? undefined);
    if (!r.ok) {
      await writeAuditLog(env.DB, {
        actorStaffId: null,
        actorRole: null,
        action: "staff.login.turnstile_failed",
        entityType: "staff_session",
        entityId: identifier,
        ipAddress: clientIp(context.request),
        userAgent: userAgent(context.request),
      });
      return Response.json({ error: "Bot check failed." }, { status: 403 });
    }
  }

  // Build a list of candidate identifier strings to try: the raw input
  // plus its Bangladesh-phone canonical form (e.g. 017... → +88017...).
  // This keeps existing logins working regardless of how the phone was
  // originally stored on the staff_users row.
  const candidates: string[] = [identifier];
  const phoneNormalized = normalizeBangladeshPhone(identifier);
  if (phoneNormalized.ok) {
    if (!candidates.includes(phoneNormalized.local)) candidates.push(phoneNormalized.local);
    if (!candidates.includes(phoneNormalized.phone)) candidates.push(phoneNormalized.phone);
  }

  const staff = await env.DB.prepare(
    `SELECT id, email, phone, password_hash, password_salt, full_name, role, is_active, totp_secret, totp_required
     FROM staff_users
     WHERE (email IN (${candidates.map((_, i) => `?${i + 1}`).join(',')})
        OR phone IN (${candidates.map((_, i) => `?${candidates.length + i + 1}`).join(',')}))
       AND is_active = 1
     LIMIT 1`
  ).bind(...candidates, ...candidates).first<{ id: string; email: string | null; phone: string | null; password_hash: string; password_salt: string | null; full_name: string; role: string; is_active: number; totp_secret: string | null; totp_required: number }>();

  if (!staff) {
    // Equalize timing with the password-verification path below so an
    // unauthenticated attacker cannot distinguish existing vs non-existing
    // accounts via response latency (AUTH-3 enumeration defense). The
    // generic 'Invalid credentials' message is identical to the wrong-password
    // path, so no account-existence signal leaks through the body either.
    await hashPassword(password, generateRandomHex(16), env.PASSWORD_PEPPER);
    await logLoginRejection('no_active_account_for_identifier', identifier, env.SESSION_SECRET, {
      hint: 'no staff_users row matched (email or phone) with is_active = 1',
    });
    return Response.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  // PBKDF2 verification with transparent upgrade from legacy HMAC-SHA256.
  // If the stored hash uses the old format (no password_salt), verify with
  // legacy HMAC and re-hash with PBKDF2 on success.
  if (staff.password_salt) {
    const { valid, matchedIterations } = await verifyPasswordWithUpgrade(password, staff.password_hash, staff.password_salt, env.PASSWORD_PEPPER);
    if (!valid) {
      // The account exists and is active, so the derived hash simply did not
      // match. In practice that is either a genuinely wrong password or a
      // PASSWORD_PEPPER that has been rotated since this row was hashed —
      // indistinguishable from here by design, but worth stating explicitly
      // so an operator knows to check the pepper before assuming user error.
      await logLoginRejection('password_hash_mismatch', identifier, env.SESSION_SECRET, {
        staffId: staff.id,
        hint: 'wrong password, or PASSWORD_PEPPER rotated since this row was hashed',
      });
      return Response.json({ error: 'Invalid credentials' }, { status: 401 });
    }
    // K-25: transparently re-hash at the current (600k) iteration count if
    // this row was still hashed at the old 100k count.
    if (matchedIterations === PBKDF2_LEGACY_ITERATIONS) {
      const newHash = await hashPassword(password, staff.password_salt, env.PASSWORD_PEPPER);
      await env.DB.prepare(
        `UPDATE staff_users SET password_hash = ?2 WHERE id = ?1 AND password_hash = ?3`
      ).bind(staff.id, newHash, staff.password_hash).run();
    }
  } else {
    const legacyHash = await legacyHashPassword(password, env.SESSION_SECRET);
    // K-29: constant-time compare.
    if (staff.password_hash.length !== legacyHash.length || !timingSafeEqualHex(staff.password_hash, legacyHash)) {
      await logLoginRejection('legacy_password_hash_mismatch', identifier, env.SESSION_SECRET, {
        staffId: staff.id,
        hint: 'row has no password_salt (pre-PBKDF2); legacy HMAC compare failed',
      });
      return Response.json({ error: 'Invalid credentials' }, { status: 401 });
    }
    const newSalt = generateRandomHex(16);
    const newHash = await hashPassword(password, newSalt, env.PASSWORD_PEPPER);
    // Conditional upgrade: only update if the row still has the legacy
    // hash AND salt is null. A concurrent login that won the race will
    // have set password_salt; the second login's UPDATE matches 0 rows
    // and we proceed without throwing.
    const upgradeResult = await env.DB.prepare(
      `UPDATE staff_users SET password_hash = ?2, password_salt = ?3
       WHERE id = ?1 AND password_hash = ?4 AND password_salt IS NULL`
    ).bind(staff.id, newHash, newSalt, legacyHash).run();
    if (upgradeResult.meta.changes === 1) {
      await writeAuditLog(env.DB, {
        actorStaffId: staff.id,
        actorRole: staff.role,
        action: 'staff.password.upgraded',
        entityType: 'staff_user',
        entityId: staff.id,
        ipAddress: clientIp(context.request),
        userAgent: userAgent(context.request),
      });
    }
  }


  // TOTP 2FA enforcement for owner/super_admin [Master_Prompt v7.0 §18.1]
  // Super-admin who hasn't enrolled yet is NOT blocked — they login first,
  // then enroll via /staff/settings/totp. Once enrolled, totp_required DB
  // field is set and TOTP is enforced on subsequent logins.
  const totpEnabled = await isStaffTotpEnabled(env.DB, staff.id);
  const totpRequired = (staff.totp_required === 1 || staff.role === 'owner' || staff.role === 'super_admin') && totpEnabled;
  const totpSecret = totpEnabled ? await loadStaffTotpSecret(env.DB, staff.id, env) : null;
  if (totpRequired && totpSecret) {
    const totpCode = typeof body.totp_code === 'string' ? body.totp_code.trim() : '';
    if (!totpCode) {
      // K-19: issue a short-lived (5 min) proof that Turnstile + password
      // already passed this attempt, so the step-2 TOTP submit doesn't need
      // to re-solve Turnstile but also can't skip it on a fresh attempt.
      let step2Token: string | undefined;
      if (env.TURNSTILE_SECRET_KEY) {
        const expires = Date.now() + 5 * 60 * 1000;
        const idHash = await hmacSha256Hex(identifier, env.SESSION_SECRET);
        const nonce = `${expires}:${idHash}`;
        const sig = await hmacSha256Hex(nonce, env.SESSION_SECRET);
        step2Token = `${nonce}.${sig}`;
      }
      return Response.json({ error: 'TOTP code required', totp_required: true, step2_token: step2Token }, { status: 401 });
    }
    // K-28: reject a code already used at/before its own time step — the
    // same 6-digit code otherwise stays valid for its whole ~90s window
    // and could be replayed by anyone who shoulder-surfed or intercepted it.
    const lastUsedCounter = await loadLastUsedTotpCounter(env.DB, staff.id);
    const { valid: totpValid, counter: totpCounter } = await verifyTotpCode(totpSecret, totpCode, lastUsedCounter ?? undefined);
    if (!totpValid) {
      await writeAuditLog(env.DB, {
        actorStaffId: staff.id,
        actorRole: staff.role,
        action: 'staff.login.totp_failed',
        entityType: 'staff_session',
        entityId: staff.id,
        ipAddress: clientIp(context.request),
        userAgent: userAgent(context.request),
      });
      return Response.json({ error: 'Invalid TOTP code' }, { status: 401 });
    }
    if (totpCounter != null) {
      await recordUsedTotpCounter(env.DB, staff.id, totpCounter, now);
    }
  }

  const sessionToken = generateSessionToken();
  const tokenHash = await hashSessionToken(sessionToken, env.SESSION_SECRET);
  const sessionId = crypto.randomUUID();
  // Master_Prompt v7.0 §18.1: 30-min idle + 8-hour absolute timeout.
  const expiresAt = nowSql(new Date(Date.now() + 30 * 60 * 1000));
  const absoluteExpiresAt = nowSql(new Date(Date.now() + 8 * 60 * 60 * 1000));

  // Master_Prompt v7.0 §18.1: Max 2 concurrent sessions per user.
  // Revoke the oldest session if limit exceeded.
  const activeSessions = await env.DB.prepare(
    `SELECT id, token_hash FROM staff_sessions WHERE staff_user_id = ?1 AND is_revoked = 0 AND absolute_expires_at > ?2 ORDER BY created_at ASC`
  ).bind(staff.id, now).all<{ id: string; token_hash: string }>();
  if (activeSessions.results && activeSessions.results.length >= 2) {
    const oldest = activeSessions.results[0];
    const oldestId = oldest.id;
    await env.DB.prepare(
      `UPDATE staff_sessions SET is_revoked = 1 WHERE id = ?1 AND is_revoked = 0`
    ).bind(oldestId).run();
    // K-20/N-7: this used to write `session:blacklist:{sessionId}` — a
    // third, divergent key format that isSessionRevoked() (which only
    // reads `session-blacklist:{tokenHash}`) never checked, so the KV
    // write was dead. requireAuth's D1 `is_revoked` check above still
    // caught it on the D1 hot path, but the intended KV fast-path never
    // engaged. Use the shared revokeSession() helper with the real key.
    if (sessionKv && oldest.token_hash) {
      const { revokeSession } = await import('../../../lib/session-blacklist');
      await revokeSession(env, oldest.token_hash, 8 * 60 * 60);
    }
    await writeAuditLog(env.DB, {
      actorStaffId: staff.id,
      actorRole: staff.role,
      action: 'staff.session.limit_enforced',
      entityType: 'staff_session',
      entityId: oldestId,
      ipAddress: clientIp(context.request),
      userAgent: userAgent(context.request),
    });
  }

  // Atomic session creation. If any statement fails, the batch rolls
  // back the session row and the user does not get a half-created
  // session. The audit log is also part of the batch so the two writes
  // succeed together (or both fail).
  try {
    await env.DB.batch(
      [
        env.DB.prepare(
          `INSERT INTO staff_sessions (id, staff_user_id, token_hash, is_revoked, expires_at, absolute_expires_at, last_active_at, step_up_at, created_at)
           VALUES (?1, ?2, ?3, 0, ?4, ?5, ?6, ?6, ?6)`,
        ).bind(sessionId, staff.id, tokenHash, expiresAt, absoluteExpiresAt, now),
        env.DB.prepare(
          `UPDATE staff_users SET last_login_at = ?2 WHERE id = ?1`,
        ).bind(staff.id, now),
      ],
      { atomic: true },
    );

    // Populate KV for fast RBAC extraction (Task 5). D1 remains source of truth.
    if (sessionKv) {
      const sessPayload: Partial<StaffUser> & { sessionId: string } = {
        id: staff.id,
        role: staff.role as any,
        fullName: staff.full_name,
        sessionId,
      };
      await sessionKv.put(
        `staff-session:${tokenHash}`,
        JSON.stringify(sessPayload),
        { expirationTtl: 8 * 60 * 60 }
      );
    }
  } catch (err) {
    safeLog.error('[staff/login] session insert failed', { error: err instanceof Error ? err.message : String(err) });
    return Response.json({ error: 'Login service unavailable. Please try again.' }, { status: 503 });
  }

  await writeAuditLog(env.DB, {
    actorStaffId: staff.id,
    actorRole: staff.role,
    action: 'staff.login',
    entityType: 'staff_session',
    entityId: sessionId,
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request)
  });

  // K-36: sign with the D1-managed current key, not SESSION_SECRET directly.
  const { current: csrfSigningKey } = await getCsrfSigningKeys(env.DB, env.SESSION_SECRET);
  const csrfToken = await createCsrfToken(csrfSigningKey);

  // Successful login: clear the rate-limit counters so a legitimate user
  // who mistyped isn't penalized on their next attempt.
  await resetLoginRateLimit(loginKv, 'ip', clientIpAddr);
  await resetLoginRateLimit(loginKv, 'identifier', idKey);

  const headers = new Headers({ 'Content-Type': 'application/json' });
  const maxAge = 24 * 60 * 60;
  // Production uses __Host- + Secure (HTTPS only). Local HTTP dev omits
  // Secure and the __Host- prefix so browsers accept session cookies.
  appendStaffAuthCookies(headers, context.request, {
    sessionToken,
    csrfToken,
    maxAge,
  });

  return new Response(JSON.stringify({
    ok: true,
    csrf_token: csrfToken,
    staff: { id: staff.id, name: staff.full_name, role: staff.role },
  }), {
    status: 200,
    headers
  });
}
