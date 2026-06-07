import { hmacSha256Hex, generateRandomHex } from './security';

const KEY_PREFIX = 'zbk_';

export function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const raw = KEY_PREFIX + generateRandomHex(32);
  const prefix = raw.slice(0, 10);
  return { raw, prefix, hash: '' };
}

export async function hashApiKey(rawKey: string): Promise<string> {
  return hmacSha256Hex(rawKey, 'api-key-hash');
}

export async function validateApiKey(db: D1Database, rawKey: string): Promise<{ id: string; name: string; permissions: string[] } | null> {
  if (!rawKey.startsWith(KEY_PREFIX)) return null;
  const keyHash = await hashApiKey(rawKey);
  const row = await db.prepare(
    `SELECT id, name, permissions FROM api_keys WHERE key_hash = ?1 AND is_revoked = 0`
  ).bind(keyHash).first<{ id: string; name: string; permissions: string }>();
  if (!row) return null;
  await db.prepare(
    `UPDATE api_keys SET last_used_at = ?1 WHERE id = ?2`
  ).bind(new Date().toISOString().replace('T', ' ').slice(0, 19), row.id).run();
  let permissions: string[];
  try { permissions = JSON.parse(row.permissions); } catch { permissions = []; }
  return { id: row.id, name: row.name, permissions };
}

export function extractApiKey(request: Request): string | null {
  const auth = request.headers.get('Authorization') ?? '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (match) return match[1];
  const key = request.headers.get('X-API-Key');
  if (key) return key;
  return null;
}
