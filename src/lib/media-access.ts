import type { ApiKeyPrincipal } from './api-keys';
import { isOwnerTier, can, type StaffUser } from './rbac';

export type MediaActor =
  | { type: 'staff'; user: StaffUser }
  | { type: 'api_key'; key: ApiKeyPrincipal };

export interface MediaObjectInput {
  id: string;
  r2Key: string;
  bucket: 'MEDIA' | 'BACKUPS';
  ownerType: 'product' | 'staff_upload' | 'integration' | 'client_private' | 'backup';
  ownerId: string;
  visibility: 'public' | 'staff' | 'owner_only' | 'private_client';
  contentType: string;
  sha256: string | null;
  uploadedByStaffId?: string | null;
  uploadedByApiKeyId?: string | null;
  createdAt: string;
}

export class MediaAccessError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'MediaAccessError';
  }

  toResponse(): Response {
    return Response.json({ ok: false, code: this.code, error: this.message }, { status: this.status });
  }
}

export function productMediaR2Key(productId: string, extension: string): string {
  const cleanProductId = productId.replace(/[^a-zA-Z0-9_-]/g, '');
  const cleanExt = extension.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  if (!cleanProductId) throw new MediaAccessError(400, 'INVALID_PRODUCT_ID', 'Invalid product id');
  return `products/${cleanProductId}/${crypto.randomUUID()}.${cleanExt}`;
}

export async function assertProductExists(db: D1Database, productId: string): Promise<void> {
  const product = await db.prepare(
    `SELECT id FROM products WHERE id = ?1 LIMIT 1`
  ).bind(productId).first<{ id: string }>();
  if (!product) throw new MediaAccessError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
}

export function assertCanWriteMedia(actor: MediaActor, media: Pick<MediaObjectInput, 'bucket' | 'ownerType' | 'ownerId' | 'visibility'>): void {
  if (actor.type === 'staff') {
    if (media.bucket === 'BACKUPS' || media.ownerType === 'backup') {
      if (!isOwnerTier(actor.user.role)) throw new MediaAccessError(403, 'BACKUP_MEDIA_OWNER_ONLY', 'Backup media is owner-only');
      return;
    }
    if (!can(actor.user.role, 'media.upload')) throw new MediaAccessError(403, 'MEDIA_UPLOAD_DENIED', 'Missing media upload permission');
    if (media.visibility === 'owner_only' && !isOwnerTier(actor.user.role)) {
      throw new MediaAccessError(403, 'OWNER_MEDIA_DENIED', 'Owner-only media requires owner-tier access');
    }
    return;
  }

  if (media.bucket !== 'MEDIA') throw new MediaAccessError(403, 'API_MEDIA_BUCKET_DENIED', 'API keys cannot write backup media');
  if (!actor.key.scopes.includes('media:upload_product_pending')) {
    throw new MediaAccessError(403, 'API_MEDIA_SCOPE_DENIED', 'Missing media upload scope');
  }
  if (media.ownerType !== 'integration') {
    throw new MediaAccessError(403, 'API_MEDIA_OWNER_DENIED', 'API media writes must use integration ownership');
  }
}

export function assertCanReadMedia(actor: MediaActor, media: MediaObjectInput): void {
  if (media.visibility === 'public') return;

  if (actor.type === 'staff') {
    if (isOwnerTier(actor.user.role)) return;
    if (media.bucket === 'BACKUPS' || media.ownerType === 'backup') {
      throw new MediaAccessError(403, 'BACKUP_MEDIA_OWNER_ONLY', 'Backup media is owner-only');
    }
    if (media.visibility === 'staff' && can(actor.user.role, 'media.upload')) return;
    if (media.uploadedByStaffId && media.uploadedByStaffId === actor.user.id) return;
    throw new MediaAccessError(403, 'MEDIA_OBJECT_DENIED', 'Media object access denied');
  }

  if (!actor.key.scopes.includes('media:read_own')) {
    throw new MediaAccessError(403, 'API_MEDIA_READ_SCOPE_DENIED', 'Missing media read scope');
  }
  if (media.uploadedByApiKeyId !== actor.key.id && media.ownerId !== actor.key.id) {
    throw new MediaAccessError(403, 'API_MEDIA_BOLA_DENIED', 'API key cannot access another owner media object');
  }
}

export async function recordMediaObject(db: D1Database, media: MediaObjectInput): Promise<void> {
  await db.prepare(
    `INSERT INTO media_objects (
      id, r2_key, bucket, owner_type, owner_id, visibility, content_type, sha256,
      uploaded_by_staff_id, uploaded_by_api_key_id, created_at
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)`
  ).bind(
    media.id,
    media.r2Key,
    media.bucket,
    media.ownerType,
    media.ownerId,
    media.visibility,
    media.contentType,
    media.sha256,
    media.uploadedByStaffId ?? null,
    media.uploadedByApiKeyId ?? null,
    media.createdAt
  ).run();
}

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}
