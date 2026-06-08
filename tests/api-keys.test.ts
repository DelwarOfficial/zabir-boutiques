import { describe, it, expect } from 'vitest';
import {
  normalizeApiKeyScopes,
  generateApiKey,
  ApiKeyError,
  API_KEY_SCOPES,
} from '../src/lib/api-keys';

describe('API key scope normalization & enforcement', () => {
  it('accepts known scopes and returns them', () => {
    const scopes = normalizeApiKeyScopes(['orders:create_assisted', 'stock:read_public']);
    expect(scopes).toContain('orders:create_assisted');
    expect(scopes).toContain('stock:read_public');
  });

  it('rejects unknown scopes with INVALID_API_SCOPE', () => {
    try {
      normalizeApiKeyScopes(['orders:create_assisted', 'orders:delete_everything']);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiKeyError);
      expect((e as ApiKeyError).code).toBe('INVALID_API_SCOPE');
      expect((e as ApiKeyError).status).toBe(400);
    }
  });

  it('deduplicates repeated scopes', () => {
    const scopes = normalizeApiKeyScopes(['media:read_own', 'media:read_own']);
    expect(scopes).toEqual(['media:read_own']);
  });

  it('non-array input yields an empty scope set', () => {
    expect(normalizeApiKeyScopes(null)).toEqual([]);
    expect(normalizeApiKeyScopes('orders:create_assisted')).toEqual([]);
    expect(normalizeApiKeyScopes(undefined)).toEqual([]);
  });

  it('ignores non-string entries', () => {
    const scopes = normalizeApiKeyScopes(['media:read_own', 42, { x: 1 }] as unknown[]);
    expect(scopes).toEqual(['media:read_own']);
  });

  it('every advertised scope is itself valid', () => {
    expect(() => normalizeApiKeyScopes([...API_KEY_SCOPES])).not.toThrow();
  });
});

describe('API key generation', () => {
  it('generates a zbk_-prefixed key with a stable 10-char prefix', () => {
    const { raw, prefix } = generateApiKey();
    expect(raw.startsWith('zbk_')).toBe(true);
    expect(prefix).toBe(raw.slice(0, 10));
    expect(raw.length).toBeGreaterThan(40);
  });

  it('produces unique keys', () => {
    const a = generateApiKey().raw;
    const b = generateApiKey().raw;
    expect(a).not.toBe(b);
  });
});
