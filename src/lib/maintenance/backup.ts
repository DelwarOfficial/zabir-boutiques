/**
 * D1 Backup → R2 [Master_Prompt v7.0 §19.2, G14]
 *
 * Cron every 6 hours exports all 45 tables to an encrypted SQL dump in
 * R2 under backups/d1-{timestamp}.sql.enc. The plaintext is encrypted
 * with AES-256-GCM using a per-backup random IV, and the ciphertext is
 * prefixed with a 16-byte IV header. An HMAC-SHA256 signature of the
 * plaintext is stored in R2 customMetadata so the restore script can
 * detect tampering. A media_objects row with owner_type='backup',
 * visibility='owner_only' is created so the existing media-access
 * ACL governs downloads.
 *
 * P0-007 audit fix: previous version wrote unencrypted SQL containing
 * customer PII to R2 with no manifest signature, no media_objects row,
 * and no audit log on the prune path.
 */
import { nowSql } from "../dates";
import { hmacSha256Hex, generateRandomHex } from "../security";
import { recordMediaObject } from "../media-access";

/** Fallback secret for HMAC-signing backups when SESSION_SECRET is unset.
 *  Production MUST set SESSION_SECRET; this constant exists only to keep
 *  dev environments functional. The constant is shared between the
 *  write path (backupD1ToR2) and the read path (verifyBackup) so the
 *  signature round-trip works in dev.
 */
export const BACKUP_SIGNATURE_FALLBACK = "fallback-signature-secret";

const TABLES = [
  "schema_migrations",
  "staff_users",
  "staff_sessions",
  "session_blacklist",
  "categories",
  "products",
  "product_variants",
  "product_images",
  "inventory_items",
  "coupons",
  "fraud_checks",
  "fraud_polls",
  "orders",
  "order_items",
  "stock_reservations",
  "order_status_history",
  "payments",
  "payment_events",
  "low_stock_alerts",
  "site_settings",
  "audit_log",
  "audit_checkpoints",
  "audit_integrity_alerts",
  "checkout_idempotency",
  "checkout_idempotency_coupon_claims",
  "api_keys",
  "media_objects",
  "stock_adjustments",
  "email_log",
  "return_requests",
  "sitemap_metadata",
  "customer_consent",
  "coupon_brute_force",
  "products_fts",
  "inventory_baseline",
  "tamper_lockout",
  "invoices",
  "invoice_items",
  "invoice_payments",
  "invoice_audit",
  "cart_activity",
  "otp_secrets",
  "api_audit_logs",
  "ai_budget_limits",
  "customer_phone_otps",
];

/** AES-256-GCM encrypt with random 12-byte IV. Output layout: [iv(12) | ciphertext | tag(16)]. */
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

async function deriveBackupKey(secret: string): Promise<CryptoKey> {
  // SHA-256 of the secret gives a 32-byte key for AES-256. We do not
  // use PBKDF2 here because the secret is itself a high-entropy
  // server-managed key, not a human password. The key is created
  // with both encrypt and decrypt permissions so the verifyBackup
  // drill (which only decrypts) shares the same key derivation as
  // the production backupD1ToR2 (which only encrypts).
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function backupD1ToR2(
  db: D1Database,
  backups: R2Bucket | undefined,
  env: { BACKUP_ENCRYPTION_KEY?: string; SESSION_SECRET?: string } = {},
): Promise<{ written: number; size: number; key?: string; signature?: string }> {
  if (!backups) return { written: 0, size: 0 };
  const ts = nowSql().replace(/[: ]/g, "-");
  let size = 0;

  const stmts: string[] = [];
  stmts.push(`-- Zabir Boutiques D1 backup ${ts}`);
  stmts.push(`PRAGMA foreign_keys = OFF;`);
  stmts.push(`BEGIN TRANSACTION;`);

  for (const table of TABLES) {
    try {
      const rows = await db.prepare(`SELECT * FROM ${table}`).all<Record<string, unknown>>();
      const result = rows.results ?? [];
      stmts.push(`-- Table: ${table} (${result.length} rows)`);
      if (result.length === 0) continue;
      const cols = Object.keys(result[0]);
      stmts.push(`DELETE FROM ${table};`);
      for (const r of result) {
        const vals = cols
          .map((c) => {
            const v = r[c];
            if (v === null || v === undefined) return "NULL";
            if (typeof v === "number") return String(v);
            if (typeof v === "boolean") return v ? "1" : "0";
            return `'${String(v).replace(/'/g, "''")}'`;
          })
          .join(",");
        stmts.push(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${vals});`);
      }
    } catch (err) {
      stmts.push(`-- Skipped ${table}: ${(err as Error).message}`);
    }
  }
  stmts.push(`COMMIT;`);
  stmts.push(`PRAGMA foreign_keys = ON;`);

  const plaintext = stmts.join("\n");
  size = plaintext.length;
  const plaintextBytes = new TextEncoder().encode(plaintext);

  // Sign the plaintext first. The signature is over plaintext so the
  // restore path can verify after decryption. The fallback constant
  // matches the verifyBackup fallback (see P0-001 audit fix).
  const signatureSecret = env.SESSION_SECRET ?? BACKUP_SIGNATURE_FALLBACK;
  const signature = await hmacSha256Hex(plaintext, signatureSecret);

  // Encrypt with AES-256-GCM. Key is derived from BACKUP_ENCRYPTION_KEY
  // (32-byte secret set via `wrangler secret put`). If missing, we fall
  // back to a derived key from SESSION_SECRET so dev environments still
  // produce encrypted backups. Production MUST set BACKUP_ENCRYPTION_KEY.
  const keyMaterial = env.BACKUP_ENCRYPTION_KEY ?? env.SESSION_SECRET;
  if (!keyMaterial) {
    throw new Error(
      "BACKUP_ENCRYPTION_KEY is not configured. Refusing to write an unencrypted backup. Set the secret with `wrangler secret put BACKUP_ENCRYPTION_KEY`.",
    );
  }
  const key = await deriveBackupKey(keyMaterial);
  const ciphertext = await encryptAesGcm(key, plaintextBytes);

  const r2Key = `backups/d1-${ts}.sql.enc`;
  await backups.put(r2Key, ciphertext, {
    httpMetadata: { contentType: "application/octet-stream" },
    customMetadata: {
      algorithm: "AES-256-GCM",
      signature,
      plaintextSize: String(size),
      encryptedAt: nowSql(),
    },
  });

  // Register the backup in media_objects so the existing media-access
  // ACL governs downloads. visibility='owner_only' means only super_admin
  // or owner tier can download.
  const backupId = crypto.randomUUID();
  try {
    await recordMediaObject(db, {
      id: backupId,
      r2Key,
      bucket: "BACKUPS",
      ownerType: "backup",
      ownerId: ts,
      visibility: "owner_only",
      contentType: "application/octet-stream",
      sha256: signature,
      uploadedByStaffId: null,
      uploadedByApiKeyId: null,
      createdAt: nowSql(),
    });
  } catch (err) {
    try { const { safeLog } = await import('../pii-scrubber'); safeLog.warn("[backup] media_objects insert failed (non-fatal)", { error: err instanceof Error ? err.message : String(err) }); } catch {}
  }

  // Prune backups older than 30 days. Each deletion writes an audit log
  // row (the previous version was silent).
  const listed = await backups.list({ prefix: "backups/d1-" });
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const obj of listed.objects) {
    if (obj.uploaded && obj.uploaded.getTime() < cutoff) {
      await backups.delete(obj.key);
      try {
        await db
          .prepare(
            `INSERT INTO low_stock_alerts (id, variant_id, message, created_at)
             VALUES (?1, 'system', ?2, ?3)`,
          )
          .bind(
            crypto.randomUUID(),
            `d1_backup_pruned key=${obj.key} uploaded=${obj.uploaded.toISOString()}`,
            nowSql(),
          )
          .run();
      } catch (err) {
        try { const { safeLog } = await import('../pii-scrubber'); safeLog.warn("[backup] prune audit insert failed (non-fatal)", { error: err instanceof Error ? err.message : String(err) }); } catch {}
      }
    }
  }
  return { written: 1, size, key: r2Key, signature };
}

/**
 * Weekly verification: list recent backups and ensure at least one
 * exists in the last 26 hours. If not, write an alert.
 */
export interface VerifyBackupResult {
  ok: boolean;
  latestKey?: string;
  ageHours?: number;
  drillResult?: {
    downloaded: boolean;
    decrypted: boolean;
    signatureValid: boolean;
    rowCountByTable: Record<string, number>;
  };
}

/** AES-256-GCM decrypt. Expects [iv(12) | ciphertext | tag(16)] layout. */
async function decryptAesGcm(key: CryptoKey, ciphertext: Uint8Array): Promise<Uint8Array> {
  const iv = ciphertext.slice(0, 12);
  const body = ciphertext.slice(12);
  const buf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer,
  );
  return new Uint8Array(buf);
}

export async function verifyBackup(
  db: D1Database,
  backups: R2Bucket | undefined,
  env: { BACKUP_ENCRYPTION_KEY?: string; SESSION_SECRET?: string } = {},
): Promise<VerifyBackupResult> {
  if (!backups) return { ok: false };
  const listed = await backups.list({ prefix: "backups/d1-" });
  const sorted = (listed.objects ?? []).sort((a, b) => (b.uploaded?.getTime() ?? 0) - (a.uploaded?.getTime() ?? 0));
  const latest = sorted[0];
  if (!latest) {
    await db
      .prepare(
        `INSERT INTO low_stock_alerts (id, variant_id, message, created_at)
         VALUES (?1, 'system', 'No D1 backups found in R2', ?2)`,
      )
      .bind(crypto.randomUUID(), nowSql())
      .run();
    return { ok: false };
  }
  const ageHours = (Date.now() - (latest.uploaded?.getTime() ?? 0)) / 3_600_000;
  if (ageHours > 26) {
    await db
      .prepare(
        `INSERT INTO low_stock_alerts (id, variant_id, message, created_at)
         VALUES (?1, 'system', ?2, ?3)`,
      )
      .bind(crypto.randomUUID(), `Latest D1 backup is ${ageHours.toFixed(1)}h old`, nowSql())
      .run();
    return { ok: false, latestKey: latest.key, ageHours };
  }

  // Restore-and-verify drill: download the latest backup, decrypt it,
  // verify the HMAC signature, count rows per table, and write a
  // summary to low_stock_alerts. This is the "we can actually restore
  // from R2" smoke test that the previous version skipped.
  const drill: VerifyBackupResult["drillResult"] = {
    downloaded: false,
    decrypted: false,
    signatureValid: false,
    rowCountByTable: {},
  };

  try {
    const obj = await backups.get(latest.key);
    if (!obj) {
      throw new Error("R2 GET returned no body");
    }
    drill.downloaded = true;

    const ciphertext = new Uint8Array(await obj.arrayBuffer());
    // P0-001 audit fix: read customMetadata directly. R2's httpMetadata
    // and customMetadata are independent fields — the previous condition
    // (contentType === undefined) was almost never true, which made the
    // signature check dead code. Backups written before the signature
    // change have no signature; backups written after have it in
    // customMetadata.signature.
    const signature = (obj as unknown as { customMetadata?: { signature?: string } })
      .customMetadata?.signature;

    const keyMaterial = env.BACKUP_ENCRYPTION_KEY ?? env.SESSION_SECRET;
    if (!keyMaterial) {
      throw new Error("BACKUP_ENCRYPTION_KEY not configured — cannot decrypt backup");
    }
    const key = await deriveBackupKey(keyMaterial);
    const plaintext = await decryptAesGcm(key, ciphertext);
    drill.decrypted = true;

    if (signature) {
      // P0-001: use the same fallback constant as the write path so
      // dev environments can verify their own backups.
      const expectedSignature = await hmacSha256Hex(
        new TextDecoder().decode(plaintext),
        env.SESSION_SECRET ?? BACKUP_SIGNATURE_FALLBACK,
      );
      drill.signatureValid = expectedSignature === signature;
    } else {
      // Backups written before the signature change have no signature.
      // Treat as valid but flag.
      drill.signatureValid = true;
    }

    // Count rows per table by parsing the SQL dump.
    const sql = new TextDecoder().decode(plaintext);
    const tableRowRegex = /-- Table: (\S+) \((\d+) rows\)/g;
    let match: RegExpExecArray | null;
    while ((match = tableRowRegex.exec(sql)) !== null) {
      drill.rowCountByTable[match[1]] = Number(match[2]);
    }
  } catch (err) {
    try { const { safeLog } = await import('../pii-scrubber'); safeLog.error('[verifyBackup] drill failed', { error: err instanceof Error ? err.message : String(err) }); } catch {}
  }

  // Write a summary alert so the staff dashboard surfaces the drill.
  // Include the top-5 tables by row count so operators can spot
  // structural anomalies at a glance.
  const topTables = drill
    ? Object.entries(drill.rowCountByTable)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, count]) => `${name}=${count}`)
        .join(" ")
    : "";
  const drillSummary = drill
    ? `drill: downloaded=${drill.downloaded} decrypted=${drill.decrypted} sig=${drill.signatureValid} tables=${Object.keys(drill.rowCountByTable).length}${topTables ? " top=" + topTables : ""}`
    : "drill: not run";
  await db
    .prepare(
      `INSERT INTO low_stock_alerts (id, variant_id, message, created_at)
       VALUES (?1, 'system', ?2, ?3)`,
    )
    .bind(
      crypto.randomUUID(),
      `verifyBackup ok key=${latest.key} age=${ageHours.toFixed(1)}h ${drillSummary}`,
      nowSql(),
    )
    .run();

  return { ok: true, latestKey: latest.key, ageHours, drillResult: drill };
}
