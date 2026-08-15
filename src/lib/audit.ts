import { nowSql } from './dates';
import { env as cloudflareEnv } from 'cloudflare:workers';
import { safeLog, scrubValue } from './pii-scrubber';

export interface AuditEntry {
  actorStaffId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
}

// K-27: X-Forwarded-For is client-settable; CF-Connecting-IP is edge-set
// by Cloudflare and cannot be forged. Trusting XFF here would let a
// caller inject an arbitrary IP into forensic audit records.
export function clientIp(request: Request): string | null {
  return request.headers.get('CF-Connecting-IP') ?? null;
}

export function userAgent(request: Request): string | null {
  const ua = request.headers.get('User-Agent');
  if (!ua) return null;
  return ua.slice(0, 512);
}

async function getAuditChainHead(db: D1Database): Promise<{ id: string; chain_hash: string } | null> {
  return db.prepare(
    `SELECT id, chain_hash FROM audit_log ORDER BY rowid DESC LIMIT 1`
  ).first<{ id: string; chain_hash: string }>();
}

function serializeForHash(entry: Required<Omit<AuditEntry, 'metadata'>> & { metadata: string | null; previousHash: string; now: string }): string {
  return `${entry.previousHash}|${entry.actorStaffId ?? ''}|${entry.actorRole ?? ''}|${entry.action}|${entry.entityType}|${entry.entityId}|${entry.metadata ?? ''}|${entry.ipAddress ?? ''}|${entry.userAgent ?? ''}|${entry.now}`;
}

async function computeHashChain(db: D1Database, entry: AuditEntry, now: string): Promise<{ previousHash: string; chainHash: string }> {
  const head = await getAuditChainHead(db);
  const previousHash = head?.chain_hash ?? '0'.repeat(64);
  const payload = serializeForHash({
    previousHash,
    actorStaffId: entry.actorStaffId ?? null,
    actorRole: entry.actorRole ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    metadata: entry.metadata != null ? JSON.stringify(entry.metadata) : null,
    ipAddress: entry.ipAddress ?? null,
    userAgent: entry.userAgent ?? null,
    now
  });
  const secret = (cloudflareEnv as { AUDIT_LEDGER_SECRET?: string })?.AUDIT_LEDGER_SECRET;
  const chainHash = secret
    ? await hmacSha256Hex(payload, secret)
    : await sha256Hex(payload);
  return { previousHash, chainHash };
}

export async function writeAuditLog(db: D1Database, entry: AuditEntry): Promise<boolean> {
  try {
    const statement = await prepareAuditLogInsert(db, entry);
    await statement.run();
    return true;
  } catch (err) {
    safeLog.error('[audit] write failed', { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

export async function prepareAuditLogInsert(db: D1Database, entry: AuditEntry, now = nowSql()): Promise<D1PreparedStatement> {
  const id = crypto.randomUUID();
  // INV-5: audit_log is append-only for 7 years. metadata is caller-supplied
  // and has carried raw phone/email/address in the past (order/customer
  // detail dumps). Scrub it the same way safeLog scrubs console output
  // before it's hashed into the chain or persisted, so the retained record
  // never has a phone/email regex match or a raw PII_KEYS field.
  const scrubbedEntry: AuditEntry = {
    ...entry,
    // entity_id has carried a raw user-typed identifier (phone/email) on at
    // least one call site (staff.login.turnstile_failed) before the
    // corresponding staff row was even looked up.
    entityId: typeof entry.entityId === 'string' ? (scrubValue(entry.entityId) as string) : entry.entityId,
    metadata: entry.metadata != null ? scrubValue(entry.metadata) : entry.metadata,
  };
  const { previousHash, chainHash } = await computeHashChain(db, scrubbedEntry, now);
  return db.prepare(
    `INSERT INTO audit_log (
      id, actor_staff_id, actor_role, action, entity_type, entity_id,
      metadata_json, ip_address, user_agent, created_at, previous_hash, chain_hash
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`
  ).bind(
    id,
    scrubbedEntry.actorStaffId,
    scrubbedEntry.actorRole,
    scrubbedEntry.action,
    scrubbedEntry.entityType,
    scrubbedEntry.entityId,
    scrubbedEntry.metadata != null ? JSON.stringify(scrubbedEntry.metadata) : null,
    scrubbedEntry.ipAddress ?? null,
    scrubbedEntry.userAgent ?? null,
    now,
    previousHash,
    chainHash
  );
}

export async function writeCriticalAuditLog(db: D1Database, entry: AuditEntry): Promise<void> {
  const written = await writeAuditLog(db, entry);
  if (!written) {
    throw new Error(`Critical audit write failed for ${entry.action}:${entry.entityType}:${entry.entityId}`);
  }
}

export async function verifyAuditChain(db: D1Database, limit = 1000): Promise<{ valid: boolean; checked: number; firstBadIndex?: number }> {
  const rows = await db.prepare(
    `SELECT id, previous_hash, chain_hash, actor_staff_id, actor_role, action, entity_type, entity_id,
            metadata_json, ip_address, user_agent, created_at, redacted_at, redaction_hash
     FROM audit_log ORDER BY created_at ASC, rowid ASC LIMIT ?1`
  ).bind(limit).all<AuditChainRow>();

  if (!rows.results || rows.results.length === 0) return { valid: true, checked: 0 };

  let expectedPreviousHash = '0'.repeat(64);
  for (let i = 0; i < rows.results.length; i++) {
    const r = rows.results[i];
    if (r.previous_hash !== expectedPreviousHash) {
      return { valid: false, checked: i, firstBadIndex: i };
    }
    if (!(await verifyRowIntegrity(r, expectedPreviousHash))) {
      return { valid: false, checked: i + 1, firstBadIndex: i };
    }
    expectedPreviousHash = r.chain_hash;
  }

  return { valid: true, checked: rows.results.length };
}

/**
 * K-31: verifyAuditChain always restarts from genesis, bounded by `limit`
 * — on a 7-year append-only log that means every run re-checks the same
 * oldest prefix forever and never actually reaches recent rows once the
 * table exceeds the limit. audit_checkpoints was already being WRITTEN
 * (writeAuditCheckpoint) but never READ back to resume from. This resumes
 * from the last checkpoint's chain_hash instead of '0'*64, verifies
 * forward up to `maxRows` new rows, and reports whether it caught up to
 * the current head — so the daily cron's cost is proportional to new
 * rows since the last check, and coverage actually advances over time
 * instead of being permanently stuck on the oldest window.
 */
export async function verifyAuditChainIncremental(
  db: D1Database,
  maxRows = 10000,
): Promise<{
  valid: boolean;
  checked: number;
  firstBadIndex?: number;
  lastVerified: { id: string; chainHash: string } | null;
  reachedHead: boolean;
}> {
  const checkpoint = await db
    // rowid tiebreaker: created_at has only second resolution, so two
    // checkpoints written within the same second would otherwise be
    // ordered arbitrarily.
    .prepare(`SELECT last_audit_id, chain_hash FROM audit_checkpoints ORDER BY created_at DESC, rowid DESC LIMIT 1`)
    .first<{ last_audit_id: string; chain_hash: string }>();

  let expectedPreviousHash = '0'.repeat(64);
  let afterRowId: string | null = null;
  if (checkpoint) {
    const stillExists = await db.prepare(`SELECT id FROM audit_log WHERE id = ?1`).bind(checkpoint.last_audit_id).first<{ id: string }>();
    if (stillExists) {
      expectedPreviousHash = checkpoint.chain_hash;
      afterRowId = checkpoint.last_audit_id;
    }
    // If the checkpointed row is gone (e.g. archived), fall back to
    // genesis rather than silently skipping unverified rows.
  }

  const rows = afterRowId
    ? await db
        .prepare(
          `SELECT id, previous_hash, chain_hash, actor_staff_id, actor_role, action, entity_type, entity_id,
                  metadata_json, ip_address, user_agent, created_at, redacted_at, redaction_hash
           FROM audit_log
           WHERE rowid > (SELECT rowid FROM audit_log WHERE id = ?1)
           ORDER BY created_at ASC, rowid ASC LIMIT ?2`,
        )
        .bind(afterRowId, maxRows)
        .all<AuditChainRow>()
    : await db
        .prepare(
          `SELECT id, previous_hash, chain_hash, actor_staff_id, actor_role, action, entity_type, entity_id,
                  metadata_json, ip_address, user_agent, created_at, redacted_at, redaction_hash
           FROM audit_log ORDER BY created_at ASC, rowid ASC LIMIT ?1`,
        )
        .bind(maxRows)
        .all<AuditChainRow>();

  const results = rows.results ?? [];
  if (results.length === 0) {
    return { valid: true, checked: 0, lastVerified: checkpoint ? { id: checkpoint.last_audit_id, chainHash: checkpoint.chain_hash } : null, reachedHead: true };
  }

  let lastVerified: { id: string; chainHash: string } | null = null;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.previous_hash !== expectedPreviousHash) {
      return { valid: false, checked: i, firstBadIndex: i, lastVerified, reachedHead: false };
    }
    if (!(await verifyRowIntegrity(r, expectedPreviousHash))) {
      return { valid: false, checked: i + 1, firstBadIndex: i, lastVerified, reachedHead: false };
    }
    expectedPreviousHash = r.chain_hash;
    lastVerified = { id: r.id, chainHash: r.chain_hash };
  }

  return { valid: true, checked: results.length, lastVerified, reachedHead: results.length < maxRows };
}

interface AuditChainRow {
  id: string; previous_hash: string; chain_hash: string;
  actor_staff_id: string | null; actor_role: string | null;
  action: string; entity_type: string; entity_id: string;
  metadata_json: string | null; ip_address: string | null; user_agent: string | null; created_at: string;
  redacted_at: string | null;
  redaction_hash: string | null;
}

/**
 * N-20: verify one chain row's content hash.
 *
 * A non-redacted row is checked the original way: recompute over the literal
 * payload and compare against chain_hash.
 *
 * A redacted row cannot be checked that way — its metadata_json was blanked
 * after chain_hash was computed, so re-deriving chain_hash is impossible by
 * construction. N-11 handled that by skipping verification entirely, which
 * left actor_staff_id, actor_role, action, entity_type, entity_id,
 * ip_address, user_agent and created_at unverified for any row where
 * redacted_at was set. Because chain_hash is HMAC'd with a secret that never
 * lives in the database, recomputation was the only thing making those
 * columns unforgeable to an attacker with D1 write access — so setting one
 * column turned any row into a freely rewritable one that still reported
 * valid.
 *
 * Instead we recompute over the POST-redaction payload (metadata
 * canonicalized to null, exactly as redactAuditLogEntry wrote it) and compare
 * against redaction_hash, which was computed with the same secret at
 * redaction time and is write-once at the database layer
 * (trg_audit_log_redaction_hash_write_once). Every surviving column stays
 * covered. A row claiming to be redacted with no redaction_hash is treated as
 * invalid rather than trusted — otherwise an attacker could re-open the hole
 * simply by omitting the column.
 */
async function verifyRowIntegrity(r: AuditChainRow, expectedPreviousHash: string): Promise<boolean> {
  const isRedacted = r.redacted_at != null;

  // A redacted row with no integrity hash is unverifiable, not trustworthy.
  if (isRedacted && !r.redaction_hash) return false;

  const payload = serializeForHash({
    previousHash: expectedPreviousHash,
    actorStaffId: r.actor_staff_id,
    actorRole: r.actor_role,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    metadata: isRedacted ? null : r.metadata_json,
    ipAddress: r.ip_address,
    userAgent: r.user_agent,
    now: r.created_at,
  });

  const expected = isRedacted ? r.redaction_hash : r.chain_hash;
  const secret = (cloudflareEnv as { AUDIT_LEDGER_SECRET?: string })?.AUDIT_LEDGER_SECRET;
  const computedSha = await sha256Hex(payload);
  if (computedSha === expected) return true;
  if (!secret) return false;
  return (await hmacSha256Hex(payload, secret)) === expected;
}

export type RedactionOutcome = 'redacted' | 'already_redacted' | 'not_found' | 'not_yet_verified';

/**
 * N-11: blank a single audit_log row's metadata_json (the field that has
 * historically carried raw customer PII pre-INV-5) without touching
 * previous_hash/chain_hash — those stay exactly as computed at write time,
 * so no row after this one needs to change and the chain never breaks.
 *
 * Requires the row to already sit behind the last verified checkpoint
 * (audit_checkpoints) — i.e. its chain_hash has already been proven
 * correct at least once — so redaction can never be used to quietly erase
 * content that was never actually verified (or that verification would
 * have caught as tampered).
 */
export async function redactAuditLogEntry(
  db: D1Database,
  auditLogId: string,
  reason: string,
  now = nowSql(),
): Promise<RedactionOutcome> {
  const row = await db
    .prepare(
      `SELECT rowid, redacted_at, previous_hash, actor_staff_id, actor_role, action,
              entity_type, entity_id, ip_address, user_agent, created_at
       FROM audit_log WHERE id = ?1`,
    )
    .bind(auditLogId)
    .first<{
      rowid: number; redacted_at: string | null; previous_hash: string;
      actor_staff_id: string | null; actor_role: string | null; action: string;
      entity_type: string; entity_id: string; ip_address: string | null;
      user_agent: string | null; created_at: string;
    }>();
  if (!row) return 'not_found';
  if (row.redacted_at) return 'already_redacted';

  const checkpoint = await db
    .prepare(`SELECT last_audit_id FROM audit_checkpoints ORDER BY created_at DESC, rowid DESC LIMIT 1`)
    .first<{ last_audit_id: string }>();
  if (!checkpoint) return 'not_yet_verified';
  const checkpointRow = await db
    .prepare(`SELECT rowid FROM audit_log WHERE id = ?1`)
    .bind(checkpoint.last_audit_id)
    .first<{ rowid: number }>();
  if (!checkpointRow || row.rowid > checkpointRow.rowid) return 'not_yet_verified';

  // N-20: hash the row as it will look AFTER redaction (metadata null) so
  // every surviving column stays covered by an HMAC the database itself
  // cannot forge. chain_hash is deliberately left untouched — subsequent
  // rows' previous_hash points at it, so rewriting it would break the chain.
  const redactedPayload = serializeForHash({
    previousHash: row.previous_hash,
    actorStaffId: row.actor_staff_id,
    actorRole: row.actor_role,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    metadata: null,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
    now: row.created_at,
  });
  const secret = (cloudflareEnv as { AUDIT_LEDGER_SECRET?: string })?.AUDIT_LEDGER_SECRET;
  const redactionHash = secret
    ? await hmacSha256Hex(redactedPayload, secret)
    : await sha256Hex(redactedPayload);

  await db
    .prepare(
      `UPDATE audit_log SET metadata_json = NULL, redacted_at = ?2, redacted_reason = ?3,
              redaction_hash = ?4 WHERE id = ?1`,
    )
    .bind(auditLogId, now, reason, redactionHash)
    .run();

  // The redaction itself is a normal, new, chain-verified append — proof
  // of who redacted what and why is retained forever, even though the
  // original PII payload is gone.
  await writeAuditLog(db, {
    actorStaffId: null,
    actorRole: null,
    action: 'audit_log.redacted',
    entityType: 'audit_log',
    entityId: auditLogId,
    metadata: { reason },
  });

  return 'redacted';
}

/**
 * N-11: redact every audit_log row tied to a customer's orders, as part of
 * the deferred-deletion flow (customer-deletion.ts). Only metadata_json is
 * blanked — action/entity_type/entity_id/created_at stay, so "what
 * happened and when" remains auditable; only the PII-carrying payload
 * (name/phone/address snapshots) is erased. Rows still ahead of the last
 * verified checkpoint are skipped this pass and picked up on a later one
 * (recordAuditIntegrityCheck runs earlier in the same daily cron, so in
 * practice this rarely matters).
 */
export async function redactAuditLogForOrders(
  db: D1Database,
  orderIds: string[],
  reason: string,
  now = nowSql(),
): Promise<{ redacted: number; skipped: number }> {
  if (orderIds.length === 0) return { redacted: 0, skipped: 0 };
  const placeholders = orderIds.map((_, i) => `?${i + 1}`).join(',');
  const rows = await db
    .prepare(
      `SELECT id FROM audit_log
       WHERE entity_type = 'order' AND entity_id IN (${placeholders})
         AND metadata_json IS NOT NULL AND redacted_at IS NULL`,
    )
    .bind(...orderIds)
    .all<{ id: string }>();

  let redacted = 0;
  let skipped = 0;
  for (const row of rows.results ?? []) {
    const outcome = await redactAuditLogEntry(db, row.id, reason, now);
    if (outcome === 'redacted') redacted++;
    else if (outcome === 'not_yet_verified') skipped++;
  }
  return { redacted, skipped };
}

export async function recordAuditIntegrityCheck(db: D1Database, limit = 10000): Promise<void> {
  const result = await verifyAuditChainIncremental(db, limit);
  await db.prepare(
    `INSERT INTO audit_integrity_alerts (id, checked_at, valid, checked_rows, first_bad_index, details_json)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
  ).bind(
    crypto.randomUUID(),
    nowSql(),
    result.valid ? 1 : 0,
    result.checked,
    result.firstBadIndex ?? null,
    JSON.stringify(result)
  ).run();

  // Advance the checkpoint to what was actually verified this run — not
  // blindly to the current head, which could be ahead of what this pass
  // covered if the log grew past `limit` new rows since the last check.
  if (result.valid && result.lastVerified) {
    await db
      .prepare(`INSERT INTO audit_checkpoints (id, last_audit_id, chain_hash, created_at) VALUES (?1, ?2, ?3, ?4)`)
      .bind(crypto.randomUUID(), result.lastVerified.id, result.lastVerified.chainHash, nowSql())
      .run()
      .catch((err) => safeLog.error('[audit] incremental checkpoint write failed', { error: err instanceof Error ? err.message : String(err) }));
  }
}

async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256Hex(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}
