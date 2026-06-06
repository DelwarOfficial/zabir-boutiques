export const prerender = false;

import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/env';
import { compressImage, downloadCompressed, generateThumbnail, thumbnailR2Key } from '../../../lib/tinify';
import { nowSql } from '../../../lib/dates';
import { requireAuth, requirePermission, RbacError } from '../../../lib/rbac';
import { writeAuditLog, clientIp, userAgent } from '../../../lib/audit';

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

  const ext = file.name.split('.').pop() ?? 'jpg';
  const r2Key = `products/${productId}/${crypto.randomUUID()}.${ext}`;
  const buffer = await file.arrayBuffer();

  const compressResult = await compressImage(buffer, env.TINIFY_API_KEY);

  let isCompressed = 0;
  let thumbnailUploaded = false;

  if (compressResult.ok) {
    const downloaded = await downloadCompressed(compressResult.locationUrl, env.TINIFY_API_KEY);
    if (downloaded.ok) {
      await env.MEDIA.put(r2Key, downloaded.compressed, { httpMetadata: { contentType: compressResult.contentType } });
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
  await env.DB.prepare(
    `INSERT INTO product_images (id, product_id, r2_key, is_compressed, sort_order, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5)`
  ).bind(imageId, productId, r2Key, isCompressed, now).run();

  await writeAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: 'media.upload',
    entityType: 'product_image',
    entityId: imageId,
    metadata: { product_id: productId, r2_key: r2Key, compressed: isCompressed === 1, thumbnail: thumbnailUploaded },
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
