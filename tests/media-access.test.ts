import { describe, it, expect } from 'vitest';
import {
  assertCanReadMedia,
  assertCanWriteMedia,
  MediaAccessError,
  type MediaObjectInput,
  type MediaActor,
} from '../src/lib/media-access';
import type { StaffUser, StaffRole } from '../src/lib/rbac';
import type { ApiKeyPrincipal, ApiKeyScope } from '../src/lib/api-keys';

function staff(role: StaffRole, id = 'staff-1'): MediaActor {
  const user: StaffUser = { id, role, fullName: 'T', sessionId: 'sess-1' };
  return { type: 'staff', user };
}
function apiKey(id: string, scopes: ApiKeyScope[]): MediaActor {
  const key: ApiKeyPrincipal = { type: 'api_key', id, name: 'k', scopes, environment: 'prod', rateLimitProfile: 'strict' };
  return { type: 'api_key', key };
}
function media(partial: Partial<MediaObjectInput>): MediaObjectInput {
  return {
    id: 'm1', r2Key: 'products/p1/x.jpg', bucket: 'MEDIA', ownerType: 'product', ownerId: 'p1',
    visibility: 'staff', contentType: 'image/jpeg', sha256: null,
    uploadedByStaffId: null, uploadedByApiKeyId: null, createdAt: '2026-06-08 00:00:00',
    ...partial,
  };
}
function codeOfThrow(fn: () => void): string | null {
  try { fn(); return null; } catch (e) { return e instanceof MediaAccessError ? e.code : 'OTHER'; }
}

describe('media read authorization', () => {
  it('public media is readable by anyone', () => {
    const pub = media({ visibility: 'public' });
    expect(codeOfThrow(() => assertCanReadMedia(staff('support'), pub))).toBeNull();
    expect(codeOfThrow(() => assertCanReadMedia(apiKey('k1', []), pub))).toBeNull();
  });

  it('owner-tier can read staff, owner-only, and backup media', () => {
    expect(codeOfThrow(() => assertCanReadMedia(staff('owner'), media({ visibility: 'owner_only' })))).toBeNull();
    expect(codeOfThrow(() => assertCanReadMedia(staff('super_admin'), media({ bucket: 'BACKUPS', ownerType: 'backup' })))).toBeNull();
  });

  it('non-owner staff cannot read backup media', () => {
    expect(codeOfThrow(() => assertCanReadMedia(staff('manager'), media({ bucket: 'BACKUPS', ownerType: 'backup' }))))
      .toBe('BACKUP_MEDIA_OWNER_ONLY');
  });

  it('staff with media.upload can read staff-visibility media, but not arbitrary private', () => {
    expect(codeOfThrow(() => assertCanReadMedia(staff('manager'), media({ visibility: 'staff' })))).toBeNull();
    expect(codeOfThrow(() => assertCanReadMedia(staff('support'), media({ visibility: 'owner_only' }))))
      .toBe('MEDIA_OBJECT_DENIED');
  });

  it('staff can read media they themselves uploaded', () => {
    const m = media({ visibility: 'owner_only', uploadedByStaffId: 'staff-9' });
    expect(codeOfThrow(() => assertCanReadMedia(staff('support', 'staff-9'), m))).toBeNull();
  });
});

describe('media BOLA protection for API keys', () => {
  it('rejects API key lacking media:read_own scope', () => {
    expect(codeOfThrow(() => assertCanReadMedia(apiKey('k1', []), media({ visibility: 'staff' }))))
      .toBe('API_MEDIA_READ_SCOPE_DENIED');
  });

  it('rejects API key reading another owner private object (BOLA)', () => {
    const m = media({ visibility: 'private_client', ownerId: 'other', uploadedByApiKeyId: 'k2' });
    expect(codeOfThrow(() => assertCanReadMedia(apiKey('k1', ['media:read_own']), m)))
      .toBe('API_MEDIA_BOLA_DENIED');
  });

  it('allows API key reading its own uploaded object', () => {
    const m = media({ visibility: 'private_client', ownerId: 'someprod', uploadedByApiKeyId: 'k1' });
    expect(codeOfThrow(() => assertCanReadMedia(apiKey('k1', ['media:read_own']), m))).toBeNull();
  });
});

describe('media write authorization', () => {
  it('staff with media.upload can write product media', () => {
    expect(codeOfThrow(() => assertCanWriteMedia(staff('manager'), { bucket: 'MEDIA', ownerType: 'product', ownerId: 'p1', visibility: 'staff' }))).toBeNull();
  });

  it('non-owner staff cannot write owner-only or backup media', () => {
    expect(codeOfThrow(() => assertCanWriteMedia(staff('manager'), { bucket: 'MEDIA', ownerType: 'product', ownerId: 'p1', visibility: 'owner_only' })))
      .toBe('OWNER_MEDIA_DENIED');
    expect(codeOfThrow(() => assertCanWriteMedia(staff('manager'), { bucket: 'BACKUPS', ownerType: 'backup', ownerId: 'b1', visibility: 'owner_only' })))
      .toBe('BACKUP_MEDIA_OWNER_ONLY');
  });

  it('staff without media.upload cannot write', () => {
    expect(codeOfThrow(() => assertCanWriteMedia(staff('support'), { bucket: 'MEDIA', ownerType: 'product', ownerId: 'p1', visibility: 'staff' })))
      .toBe('MEDIA_UPLOAD_DENIED');
  });

  it('API key must have upload scope, MEDIA bucket, and integration ownership', () => {
    expect(codeOfThrow(() => assertCanWriteMedia(apiKey('k1', []), { bucket: 'MEDIA', ownerType: 'integration', ownerId: 'k1', visibility: 'staff' })))
      .toBe('API_MEDIA_SCOPE_DENIED');
    expect(codeOfThrow(() => assertCanWriteMedia(apiKey('k1', ['media:upload_product_pending']), { bucket: 'BACKUPS', ownerType: 'integration', ownerId: 'k1', visibility: 'staff' })))
      .toBe('API_MEDIA_BUCKET_DENIED');
    expect(codeOfThrow(() => assertCanWriteMedia(apiKey('k1', ['media:upload_product_pending']), { bucket: 'MEDIA', ownerType: 'product', ownerId: 'p1', visibility: 'staff' })))
      .toBe('API_MEDIA_OWNER_DENIED');
    expect(codeOfThrow(() => assertCanWriteMedia(apiKey('k1', ['media:upload_product_pending']), { bucket: 'MEDIA', ownerType: 'integration', ownerId: 'k1', visibility: 'staff' })))
      .toBeNull();
  });
});
