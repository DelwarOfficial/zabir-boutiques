import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/env';
import { compressImage, downloadCompressed, generateThumbnail, thumbnailR2Key } from '../../../lib/tinify';
import { nowSql } from '../../../lib/dates';
import { requireAuth, requirePermission, RbacError } from '../../../lib/rbac';
import { writeCriticalAuditLog, clientIp, userAgent } from '../../../lib/audit';
import {
  assertCanWriteMedia,
  assertProductExists,
  productMediaR2Key,
  recordMediaObject,
  sha256Hex,
  MediaAccessError
} from '../../../lib/media-access';

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
const MAX_SIZE = 20 * 1024 * 1024;

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const now = nowSql();

  let user;
  try {
    user = await requireAuth(context);
    requirePermission(user, 'media.upload');
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }

  let formData: FormData;
  try { formData = await context.request.formData(); } catch { return Response.json({ error: 'Invalid form data' }, { status: 400 }); }

  const file = formData.get('file') as File | null;
  if (!file) return Response.json({ error: 'No file uploaded' }, { status: 400 });

  if (!ALLOWED_TYPES.has(file.type)) {
    return Response.json({ error: 'Invalid file type. Allowed: JPEG, PNG, WebP, GIF, AVIF' }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return Response.json({ error: 'File too large. Max 20MB' }, { status: 400 });
  }

  const productId = formData.get('product_id') as string | null;
  if (!productId) return Response.json({ error: 'Missing product_id' }, { status: 400 });

  try {
    await assertProductExists(env.DB, productId);
    assertCanWriteMedia({ type: 'staff', user }, {
      bucket: 'MEDIA',
      ownerType: 'product',
      ownerId: productId,
      visibility: 'staff'
    });
  } catch (err) {
    if (err instanceof MediaAccessError) return err.toResponse();
    throw err;
  }

  const ext = file.name.split('.').pop() ?? 'jpg';
  const r2Key = productMediaR2Key(productId, ext);
  const buffer = await file.arrayBuffer();
  let storedBuffer = buffer;
  let storedContentType = file.type;

  const compressResult = await compressImage(buffer, env.TINIFY_API_KEY);

  let isCompressed = 0;
  let thumbnailUploaded = false;

  if (compressResult.ok) {
    const downloaded = await downloadCompressed(compressResult.locationUrl, env.TINIFY_API_KEY);
    if (downloaded.ok) {
      await env.MEDIA.put(r2Key, downloaded.compressed, { httpMetadata: { contentType: compressResult.contentType } });
      storedBuffer = downloaded.compressed;
      storedContentType = compressResult.contentType;
      isCompressed = 1;

      const thumbResult = await generateThumbnail(compressResult.locationUrl, env.TINIFY_API_KEY);
      if (thumbResult.ok) {
        const thumbKey = thumbnailR2Key(r2Key);
        await env.MEDIA.put(thumbKey, thumbResult.data, { httpMetadata: { contentType: 'image/webp' } });
        thumbnailUploaded = true;
      }
    } else {
      await env.MEDIA.put(r2Key, buffer, { httpMetadata: { contentType: file.type } });
    }
  } else {
    await env.MEDIA.put(r2Key, buffer, { httpMetadata: { contentType: file.type } });
  }

  const imageId = crypto.randomUUID();
  const contentHash = await sha256Hex(storedBuffer);
  const altText = (formData.get('alt_text') as string | null)?.trim() || null;
  await env.DB.prepare(
    `INSERT INTO product_images (id, product_id, r2_key, is_compressed, alt_text, sort_order, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6, ?6)`
  ).bind(imageId, productId, r2Key, isCompressed, altText, now).run();

  await recordMediaObject(env.DB, {
    id: imageId,
    r2Key,
    bucket: 'MEDIA',
    ownerType: 'product',
    ownerId: productId,
    visibility: 'staff',
    contentType: storedContentType,
    sha256: contentHash,
    uploadedByStaffId: user.id,
    uploadedByApiKeyId: null,
    createdAt: now
  });

  await writeCriticalAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: 'media.upload',
    entityType: 'product_image',
    entityId: imageId,
    metadata: { product_id: productId, r2_key: r2Key, sha256: contentHash, compressed: isCompressed === 1, thumbnail: thumbnailUploaded },
    ipAddress: clientIp(context.request),
    userAgent: userAgent(context.request)
  });

  return Response.json({
    ok: true,
    image_id: imageId,
    r2_key: r2Key,
    compressed: isCompressed === 1,
    thumbnail_key: thumbnailUploaded ? thumbnailR2Key(r2Key) : null,
  }, { status: 201 });
}
