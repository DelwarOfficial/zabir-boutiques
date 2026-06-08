import { hmacSha256Hex, generateRandomHex } from './security';
import { nowSql } from './dates';

const KEY_PREFIX = 'zbk_';

export const API_KEY_SCOPES = [
  'orders:create_assisted',
  'orders:read_own_integration',
  'stock:read_public',
  'media:upload_product_pending',
  'media:read_own',
  'webhooks:payment_status_read'
] as const;

export type ApiKeyScope = typeof API_KEY_SCOPES[number];

const API_KEY_SCOPE_SET: ReadonlySet<string> = new Set(API_KEY_SCOPES);

export interface ApiKeyPrincipal {
  type: 'api_key';
  id: string;
  name: string;
  scopes: ApiKeyScope[];
  environment: string;
  rateLimitProfile: string;
}

export class ApiKeyError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'ApiKeyError';
  }

  toResponse(): Response {
    return Response.json({ ok: false, code: this.code, error: this.message }, { status: this.status });
  }
}

export function generateApiKey(): { raw: string; prefix: string } {
  const raw = KEY_PREFIX + generateRandomHex(32);
  const prefix = raw.slice(0, 10);
  return { raw, prefix };
}

export function normalizeApiKeyScopes(value: unknown): ApiKeyScope[] {
  if (!Array.isArray(value)) return [];
  const scopes = Array.from(new Set(value.filter((item): item is string => typeof item === 'string')));
  const unknown = scopes.filter(scope => !API_KEY_SCOPE_SET.has(scope));
  if (unknown.length) {
    throw new ApiKeyError(400, 'INVALID_API_SCOPE', `Unknown API key scope: ${unknown.join(', ')}`);
  }
  return scopes as ApiKeyScope[];
}

export async function hashApiKey(rawKey: string, pepper: string): Promise<string> {
  if (!pepper) throw new ApiKeyError(500, 'API_KEY_PEPPER_MISSING', 'API key pepper is not configured');
  return hmacSha256Hex(rawKey, pepper);
}

export async function validateApiKey(
  db: D1Database,
  rawKey: string,
  pepper: string,
  request?: Request
): Promise<ApiKeyPrincipal | null> {
  if (!rawKey.startsWith(KEY_PREFIX)) return null;
  const keyHash = await hashApiKey(rawKey, pepper);
  const now = nowSql();
  const row = await db.prepare(
    `SELECT id, name, permissions, scopes_json, expires_at, allowed_ips_json, rate_limit_profile, environment
     FROM api_keys
     WHERE key_hash = ?1
       AND is_revoked = 0
       AND (expires_at IS NULL OR expires_at > ?2)`
  ).bind(keyHash, now).first<{
    id: string;
    name: string;
    permissions: string | null;
    scopes_json: string | null;
    expires_at: string | null;
    allowed_ips_json: string | null;
    rate_limit_profile: string | null;
    environment: string | null;
  }>();
  if (!row) return null;

  if (row.allowed_ips_json && request) {
    const allowedIps = parseStringArray(row.allowed_ips_json);
    const ip = request.headers.get('CF-Connecting-IP') ?? request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ?? '';
    if (allowedIps.length && !allowedIps.includes(ip)) {
      throw new ApiKeyError(403, 'API_KEY_IP_DENIED', 'API key is not allowed from this IP');
    }
  }

  const scopePayload = row.scopes_json ?? row.permissions ?? '[]';
  const scopes = normalizeApiKeyScopes(parseJson(scopePayload));

  await db.prepare(
    `UPDATE api_keys SET last_used_at = ?1 WHERE id = ?2`
  ).bind(now, row.id).run();

  return {
    type: 'api_key',
    id: row.id,
    name: row.name,
    scopes,
    environment: row.environment ?? 'prod',
    rateLimitProfile: row.rate_limit_profile ?? 'strict'
  };
}

export function extractApiKey(request: Request): string | null {
  const auth = request.headers.get('Authorization') ?? '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (match) return match[1];
  const key = request.headers.get('X-API-Key');
  if (key) return key;
  return null;
}

export async function requireApiKeyScope(
  db: D1Database,
  request: Request,
  pepper: string,
  scope: ApiKeyScope
): Promise<ApiKeyPrincipal> {
  const rawKey = extractApiKey(request);
  if (!rawKey) throw new ApiKeyError(401, 'API_KEY_REQUIRED', 'API key required');
  const principal = await validateApiKey(db, rawKey, pepper, request);
  if (!principal) throw new ApiKeyError(401, 'API_KEY_INVALID', 'Invalid API key');
  if (!principal.scopes.includes(scope)) {
    throw new ApiKeyError(403, 'API_SCOPE_DENIED', `Missing API key scope: ${scope}`);
  }
  return principal;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

function parseStringArray(value: string): string[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
}
