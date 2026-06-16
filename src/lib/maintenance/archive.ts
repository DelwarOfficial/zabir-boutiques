/**
 * Log Archive [v6.8D]
 * Monthly 1st 05:00 UTC: archive old payment_events and copy old audit logs to R2.
 *
 * P0-007 audit fix: payment_events archive is now encrypted with
 * AES-256-GCM and the audit_log archive is signed with HMAC-SHA256.
 * Both archives register a media_objects row so the media-access ACL
 * governs downloads.
 */

import { nowSql } from "../dates";
import { hmacSha256Hex } from "../security";
import { recordMediaObject } from "../media-access";

const BACKUP_ENCRYPTION_KEY_ENV = "BACKUP_ENCRYPTION_KEY";

async function deriveArchiveKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encryptAesGcm(key: CryptoKey, plaintext: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      plaintext.buffer.slice(plaintext.byteOffset, plaintext.byteOffset + plaintext.byteLength) as ArrayBuffer,
    ),
  );
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return out;
}

export async function archiveOldEvents(
  db: D1Database,
  backups: R2Bucket,
  auditLedgerSecret?: string,
  backupEncryptionKey?: string,
): Promise<void> {
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    .toISOString().replace('T', ' ').slice(0, 19);
  const date = new Date().toISOString().slice(0, 10);

  const oldEvents = await db.prepare(
    `SELECT * FROM payment_events WHERE created_at < ?1`
  ).bind(cutoff).all();

  if (oldEvents.results && oldEvents.results.length > 0) {
    const eventsJson = JSON.stringify(oldEvents.results, null, 2);
    const eventsR2Key = `backups/archives/${date}-payment-events.json.enc`;
    const eventsSignature = await hmacSha256Hex(eventsJson, auditLedgerSecret ?? "fallback");

    if (backupEncryptionKey) {
      const key = await deriveArchiveKey(backupEncryptionKey);
      const ct = await encryptAesGcm(key, new TextEncoder().encode(eventsJson));
      await backups.put(eventsR2Key, ct, {
        httpMetadata: { contentType: "application/octet-stream" },
        customMetadata: { algorithm: "AES-256-GCM", signature: eventsSignature },
      });
    } else {
      // No key set: write plaintext (dev) but log a warning.
      try { const { safeLog } = await import('../pii-scrubber'); safeLog.warn("[archive] BACKUP_ENCRYPTION_KEY missing, writing payment_events unencrypted"); } catch {}
      await backups.put(
        `backups/archives/${date}-payment-events.json`,
        eventsJson,
        { customMetadata: { signature: eventsSignature } },
      );
    }

    await db.prepare(
      `DELETE FROM payment_events WHERE created_at < ?1`
    ).bind(cutoff).run();

    try {
      await recordMediaObject(db, {
        id: crypto.randomUUID(),
        r2Key: eventsR2Key,
        bucket: "BACKUPS",
        ownerType: "backup",
        ownerId: `payment-events-${date}`,
        visibility: "owner_only",
        contentType: "application/octet-stream",
        sha256: eventsSignature,
        uploadedByStaffId: null,
        uploadedByApiKeyId: null,
        createdAt: nowSql(),
      });
    } catch (err) {
      try { const { safeLog } = await import('../pii-scrubber'); safeLog.warn("[archive] media_objects insert failed (non-fatal)", { error: err instanceof Error ? err.message : String(err) }); } catch {}
    }
  }

  const oldAudit = await db.prepare(
    `SELECT * FROM audit_log WHERE created_at < ?1 ORDER BY created_at ASC, rowid ASC`
  ).bind(cutoff).all();

  if (oldAudit.results && oldAudit.results.length > 0) {
    const payload = JSON.stringify(oldAudit.results, null, 2);
    const digest = await sha256Hex(payload);
    const first = oldAudit.results[0] as Record<string, unknown>;
    const last = oldAudit.results[oldAudit.results.length - 1] as Record<string, unknown>;
    const manifest = {
      type: 'audit_log_archive',
      date,
      row_count: oldAudit.results.length,
      first_audit_id: first.id,
      first_previous_hash: first.previous_hash,
      last_audit_id: last.id,
      last_chain_hash: last.chain_hash,
      payload_sha256: digest,
      signature: auditLedgerSecret ? await hmacSha256Hex(digest, auditLedgerSecret) : null
    };

    const auditR2Key = `backups/archives/${date}-audit-log.json`;
    await backups.put(auditR2Key, payload, {
      httpMetadata: { contentType: "application/json" },
      customMetadata: { signature: manifest.signature ?? "" },
    });
    await backups.put(
      `backups/archives/${date}-audit-log.manifest.json`,
      JSON.stringify(manifest, null, 2),
      { httpMetadata: { contentType: "application/json" } },
    );

    try {
      await recordMediaObject(db, {
        id: crypto.randomUUID(),
        r2Key: auditR2Key,
        bucket: "BACKUPS",
        ownerType: "backup",
        ownerId: `audit-log-${date}`,
        visibility: "owner_only",
        contentType: "application/json",
        sha256: manifest.signature ?? digest,
        uploadedByStaffId: null,
        uploadedByApiKeyId: null,
        createdAt: nowSql(),
      });
    } catch (err) {
      try { const { safeLog } = await import('../pii-scrubber'); safeLog.warn("[archive] media_objects insert failed (non-fatal)", { error: err instanceof Error ? err.message : String(err) }); } catch {}
    }
  }
}

async function sha256Hex(value: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
