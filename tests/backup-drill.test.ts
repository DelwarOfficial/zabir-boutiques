import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Tests for the Phase-7 backup decryption + restore-drill logic.
 *
 * The verifyBackup function downloads the most recent R2 object, decrypts
 * the AES-256-GCM ciphertext, verifies the HMAC signature, parses the
 * SQL dump for per-table row counts, and writes a summary alert.
 */

interface R2ObjectBody {
  key: string;
  uploaded: Date;
  arrayBuffer: () => Promise<ArrayBuffer>;
  customMetadata?: Record<string, string>;
  httpMetadata?: { contentType?: string };
}

function makeR2(
  objects: Array<{
    key: string;
    uploaded: Date;
    data: ArrayBuffer | Uint8Array;
    customMetadata?: Record<string, string>;
  }>,
): R2Bucket {
  return {
    async list({ prefix }: { prefix: string }) {
      return {
        objects: objects
          .filter((o) => o.key.startsWith(prefix))
          .map((o) => ({ key: o.key, uploaded: o.uploaded })) as unknown as R2Objects[],
      };
    },
    async get(key: string): Promise<R2ObjectBody | null> {
      const o = objects.find((x) => x.key === key);
      if (!o) return null;
      return {
        key: o.key,
        uploaded: o.uploaded,
        arrayBuffer: async () => {
          if (o.data instanceof ArrayBuffer) return o.data;
          const u8 = o.data as Uint8Array;
          return u8.buffer.slice(
            u8.byteOffset,
            u8.byteOffset + u8.byteLength,
          ) as ArrayBuffer;
        },
        customMetadata: o.customMetadata,
      };
    },
  } as unknown as R2Bucket;
}

function makeD1(): D1Database & { invocations: Array<{ sql: string; args: any[] }> } {
  const invocations: Array<{ sql: string; args: any[] }> = [];
  return {
    invocations,
    prepare(sql: string) {
      let bound: any[] = [];
      const stmt: any = {
        bind(...params: any[]) {
          bound = params;
          return stmt;
        },
        async all<T>() {
          invocations.push({ sql, args: bound });
          return { results: [] as T[] };
        },
        async first<T>() {
          invocations.push({ sql, args: bound });
          return null as T;
        },
        async run() {
          invocations.push({ sql, args: [...bound] });
          return { meta: { changes: 1 } };
        },
      };
      return stmt;
    },
  } as unknown as D1Database & { invocations: Array<{ sql: string; args: any[] }> };
}

async function encryptBackup(plaintext: string, key: CryptoKey): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  const out = new Uint8Array(iv.length + body.length);
  out.set(iv, 0);
  out.set(body, iv.length);
  return out;
}

async function deriveKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(secret),
  );
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

describe("verifyBackup Phase-7 drill", () => {
  let env: { BACKUP_ENCRYPTION_KEY?: string; SESSION_SECRET?: string };

  beforeEach(() => {
    env = { BACKUP_ENCRYPTION_KEY: "test-backup-key" };
  });

  it("returns ok=false and writes an alert when no backups exist", async () => {
    const { verifyBackup } = await import("../src/lib/maintenance/backup");
    const r2 = makeR2([]);
    const db = makeD1();
    const result = await verifyBackup(db, r2, env);
    expect(result.ok).toBe(false);
    const alerts = db.invocations.filter((i) =>
      /INSERT INTO low_stock_alerts/.test(i.sql),
    );
    expect(alerts.length).toBeGreaterThanOrEqual(1);
  });

  it("decrypts the latest backup and counts rows per table", async () => {
    const { verifyBackup } = await import("../src/lib/maintenance/backup");
    const key = await deriveKey(env.BACKUP_ENCRYPTION_KEY!);
    const plaintext = [
      "-- Zabir Boutiques D1 backup 2026-06-15",
      "PRAGMA foreign_keys = OFF;",
      "BEGIN TRANSACTION;",
      "-- Table: orders (42 rows)",
      "DELETE FROM orders;",
      "-- Table: order_items (123 rows)",
      "DELETE FROM order_items;",
      "COMMIT;",
      "PRAGMA foreign_keys = ON;",
    ].join("\n");
    const ciphertext = await encryptBackup(plaintext, key);
    const r2 = makeR2([
      {
        key: "backups/d1-2026-06-15-00-00-00.sql.enc",
        uploaded: new Date(),
        data: ciphertext,
        customMetadata: { algorithm: "AES-256-GCM" },
      },
    ]);
    const db = makeD1();
    const result = await verifyBackup(db, r2, env);
    expect(result.ok).toBe(true);
    expect(result.drillResult?.decrypted).toBe(true);
    expect(result.drillResult?.rowCountByTable).toEqual({
      orders: 42,
      order_items: 123,
    });
  });

  it("writes a verifyBackup ok summary alert", async () => {
    const { verifyBackup } = await import("../src/lib/maintenance/backup");
    const key = await deriveKey(env.BACKUP_ENCRYPTION_KEY!);
    const plaintext =
      "-- Zabir Boutiques D1 backup 2026-06-15\nPRAGMA foreign_keys = OFF;\n";
    const ciphertext = await encryptBackup(plaintext, key);
    const r2 = makeR2([
      {
        key: "backups/d1-2026-06-15-00-00-00.sql.enc",
        uploaded: new Date(),
        data: ciphertext,
        customMetadata: { algorithm: "AES-GCM" },
      },
    ]);
    const db = makeD1();
    await verifyBackup(db, r2, env);
    const summary = db.invocations.find((i) => {
      if (!/INSERT INTO low_stock_alerts/.test(i.sql)) return false;
      const flat = i.args.map((a: unknown) => String(a)).join(" ");
      return /verifyBackup ok/.test(flat);
    });
    expect(summary).toBeDefined();
  });

  it("flags stale backups (>26h) as failed", async () => {
    const { verifyBackup } = await import("../src/lib/maintenance/backup");
    const r2 = makeR2([
      {
        key: "backups/d1-old.sql.enc",
        uploaded: new Date(Date.now() - 30 * 60 * 60 * 1000),
        data: new ArrayBuffer(0),
      },
    ]);
    const db = makeD1();
    const result = await verifyBackup(db, r2, env);
    expect(result.ok).toBe(false);
    expect(result.ageHours).toBeGreaterThan(26);
  });
});
