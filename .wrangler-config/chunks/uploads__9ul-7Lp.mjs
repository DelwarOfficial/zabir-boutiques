globalThis.process ??= {};
globalThis.process.env ??= {};
import { g as getEnv } from "./env_BNqnkDbh.mjs";
import { compressImage, downloadCompressed, generateThumbnail, thumbnailR2Key } from "./tinify_Bgri1Y52.mjs";
import { n as nowSql } from "./sequence_XySMyPne.mjs";
import { f as can, r as requireAuth, a as requirePermission, R as RbacError } from "./rbac_cfH-YcoZ.mjs";
import { b as writeCriticalAuditLog, u as userAgent, c as clientIp } from "./worker-entry_CjpE2ho_.mjs";
class MediaAccessError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "MediaAccessError";
  }
  status;
  code;
  toResponse() {
    return Response.json({ ok: false, code: this.code, error: this.message }, { status: this.status });
  }
}
function productMediaR2Key(productId, extension) {
  const cleanProductId = productId.replace(/[^a-zA-Z0-9_-]/g, "");
  const cleanExt = extension.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  if (!cleanProductId) throw new MediaAccessError(400, "INVALID_PRODUCT_ID", "Invalid product id");
  return `products/${cleanProductId}/${crypto.randomUUID()}.${cleanExt}`;
}
async function assertProductExists(db, productId) {
  const product = await db.prepare(
    `SELECT id FROM products WHERE id = ?1 LIMIT 1`
  ).bind(productId).first();
  if (!product) throw new MediaAccessError(404, "PRODUCT_NOT_FOUND", "Product not found");
}
function assertCanWriteMedia(actor, media) {
  {
    if (!can(actor.user.role, "media.upload")) throw new MediaAccessError(403, "MEDIA_UPLOAD_DENIED", "Missing media upload permission");
    return;
  }
}
async function recordMediaObject(db, media) {
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
    null,
    media.createdAt
  ).run();
}
async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
const prerender = false;
const ALLOWED_TYPES = /* @__PURE__ */ new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const MAX_SIZE = 20 * 1024 * 1024;
async function POST(context) {
  const env = getEnv();
  const now = nowSql();
  let user;
  try {
    user = await requireAuth(context);
    requirePermission(user, "media.upload");
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }
  let formData;
  try {
    formData = await context.request.formData();
  } catch {
    return Response.json({ error: "Invalid form data" }, { status: 400 });
  }
  const file = formData.get("file");
  if (!file) return Response.json({ error: "No file uploaded" }, { status: 400 });
  if (!ALLOWED_TYPES.has(file.type)) {
    return Response.json({ error: "Invalid file type. Allowed: JPEG, PNG, WebP, GIF, AVIF" }, { status: 400 });
  }
  if (file.size > MAX_SIZE) {
    return Response.json({ error: "File too large. Max 20MB" }, { status: 400 });
  }
  const productId = formData.get("product_id");
  if (!productId) return Response.json({ error: "Missing product_id" }, { status: 400 });
  try {
    await assertProductExists(env.DB, productId);
    assertCanWriteMedia({ type: "staff", user }, {
      bucket: "MEDIA",
      ownerType: "product",
      ownerId: productId,
      visibility: "staff"
    });
  } catch (err) {
    if (err instanceof MediaAccessError) return err.toResponse();
    throw err;
  }
  const ext = file.name.split(".").pop() ?? "jpg";
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
        await env.MEDIA.put(thumbKey, thumbResult.data, { httpMetadata: { contentType: "image/webp" } });
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
  await env.DB.prepare(
    `INSERT INTO product_images (id, product_id, r2_key, is_compressed, sort_order, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, 0, ?5, ?5)`
  ).bind(imageId, productId, r2Key, isCompressed, now).run();
  await recordMediaObject(env.DB, {
    id: imageId,
    r2Key,
    bucket: "MEDIA",
    ownerType: "product",
    ownerId: productId,
    visibility: "staff",
    contentType: storedContentType,
    sha256: contentHash,
    uploadedByStaffId: user.id,
    createdAt: now
  });
  await writeCriticalAuditLog(env.DB, {
    actorStaffId: user.id,
    actorRole: user.role,
    action: "media.upload",
    entityType: "product_image",
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
    thumbnail_key: thumbnailUploaded ? thumbnailR2Key(r2Key) : null
  }, { status: 201 });
}
const _page = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  POST,
  prerender
}, Symbol.toStringTag, { value: "Module" }));
const page = () => _page;
export {
  page
};
