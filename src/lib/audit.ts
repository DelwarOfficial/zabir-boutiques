import { nowSql } from './dates';
import { env as cloudflareEnv } from 'cloudflare:workers';
import { safeLog } from './pii-scrubber';

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

export function clientIp(request: Request): string | null {
  return (
    request.headers.get('CF-Connecting-IP') ??
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ??
    null
  );
}

export function userAgent(request: Request): string | null {
  const ua = request.headers.get('User-Agent');
  if (!ua) return null;
  return ua.slice(0, 512);
}

async function getAuditChainHead(db: D1Database): Promise<{ id: string; chain_hash: string } | null> {
  return db.prepare(
    `SELECT id, chain_hash FROM audit_log ORDER BY created_at DESC, rowid DESC LIMIT 1`
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
    const now = nowSql();
    const id = crypto.randomUUID();
    const { previousHash, chainHash } = await computeHashChain(db, entry, now);
    await db.prepare(
      `INSERT INTO audit_log (
        id, actor_staff_id, actor_role, action, entity_type, entity_id,
        metadata_json, ip_address, user_agent, created_at, previous_hash, chain_hash
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`
    ).bind(
      id,
      entry.actorStaffId,
      entry.actorRole,
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.metadata != null ? JSON.stringify(entry.metadata) : null,
      entry.ipAddress ?? null,
      entry.userAgent ?? null,
      now,
      previousHash,
      chainHash
    ).run();
    return true;
  } catch (err) {
    safeLog.error('[audit] write failed', { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
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
            metadata_json, ip_address, user_agent, created_at
     FROM audit_log ORDER BY created_at ASC, rowid ASC LIMIT ?1`
  ).bind(limit).all<{
    id: string; previous_hash: string; chain_hash: string;
    actor_staff_id: string | null; actor_role: string | null;
    action: string; entity_type: string; entity_id: string;
    metadata_json: string | null; ip_address: string | null; user_agent: string | null; created_at: string
  }>();

  if (!rows.results || rows.results.length === 0) return { valid: true, checked: 0 };

  let expectedPreviousHash = '0'.repeat(64);
  for (let i = 0; i < rows.results.length; i++) {
    const r = rows.results[i];
    if (r.previous_hash !== expectedPreviousHash) {
      return { valid: false, checked: i, firstBadIndex: i };
    }
    const payload = serializeForHash({
      previousHash: expectedPreviousHash,
      actorStaffId: r.actor_staff_id,
      actorRole: r.actor_role,
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      metadata: r.metadata_json,
      ipAddress: r.ip_address,
      userAgent: r.user_agent,
      now: r.created_at
    });
    const secret = (cloudflareEnv as { AUDIT_LEDGER_SECRET?: string })?.AUDIT_LEDGER_SECRET;
    const computedSha = await sha256Hex(payload);
    const computedHmac = secret ? await hmacSha256Hex(payload, secret) : null;
    if (computedSha !== r.chain_hash && computedHmac !== r.chain_hash) {
      return { valid: false, checked: i + 1, firstBadIndex: i };
    }
    expectedPreviousHash = r.chain_hash;
  }

  return { valid: true, checked: rows.results.length };
}

export async function writeAuditCheckpoint(db: D1Database): Promise<void> {
  try {
    const head = await getAuditChainHead(db);
    if (!head) return;
    await db.prepare(
      `INSERT INTO audit_checkpoints (id, last_audit_id, chain_hash, created_at) VALUES (?1, ?2, ?3, ?4)`
    ).bind(crypto.randomUUID(), head.id, head.chain_hash, nowSql()).run();
  } catch (err) {
    safeLog.error('[audit] checkpoint write failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

export async function recordAuditIntegrityCheck(db: D1Database, limit = 10000): Promise<void> {
  const result = await verifyAuditChain(db, limit);
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
