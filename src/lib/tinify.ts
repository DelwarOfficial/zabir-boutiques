import { TinifyClient } from './integrations/tinify';

export type CompressOk = {
  ok: true;
  compressed: ArrayBuffer;
  locationUrl: string;
  inputSize: number;
  outputSize: number;
  contentType: string;
};

export type CompressErr = { ok: false; error: string };
export type CompressResult = CompressOk | CompressErr;

export type ResizeMethod = 'scale' | 'fit' | 'cover' | 'thumb';

export type ResizeOptions = {
  method: ResizeMethod;
  width: number;
  height?: number;
};

export type ConvertTarget = 'image/webp' | 'image/avif' | 'image/jpeg' | 'image/png';

function basicAuth(apiKey: string): string {
  return `Basic ${btoa(`api:${apiKey}`)}`;
}

function nowSql(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export async function compressImage(
  imageBuffer: ArrayBuffer,
  apiKey: string,
  env?: { DB?: D1Database; PROVIDER_HEALTH_DO?: DurableObjectNamespace }
): Promise<CompressResult> {
  return new TinifyClient(env).compressImage(imageBuffer, apiKey);
}

export async function downloadCompressed(locationUrl: string, apiKey: string, env?: { DB?: D1Database; PROVIDER_HEALTH_DO?: DurableObjectNamespace }): Promise<CompressResult> {
  return new TinifyClient(env).downloadCompressed(locationUrl, apiKey);
}

export async function processImage(
  locationUrl: string,
  apiKey: string,
  options: {
    resize?: ResizeOptions;
    convert?: ConvertTarget | ConvertTarget[] | '*/*';
  } = {},
  env?: { DB?: D1Database; PROVIDER_HEALTH_DO?: DurableObjectNamespace }
): Promise<{ ok: true; data: ArrayBuffer; contentType: string } | { ok: false; error: string }> {
  return new TinifyClient(env).processImage(locationUrl, apiKey, options);
}

export const THUMBNAIL_SUFFIX = '_thumb.webp';
export const THUMBNAIL_WIDTH = 300;
export const THUMBNAIL_HEIGHT = 300;

export function thumbnailR2Key(fullR2Key: string): string {
  const base = fullR2Key.replace(/\.[^.]+$/, '');
  return `${base}${THUMBNAIL_SUFFIX}`;
}

export async function generateThumbnail(
  locationUrl: string,
  apiKey: string,
  env?: { DB?: D1Database; PROVIDER_HEALTH_DO?: DurableObjectNamespace }
): Promise<{ ok: true; data: ArrayBuffer; contentType: string } | { ok: false; error: string }> {
  return processImage(locationUrl, apiKey, {
    resize: { method: 'cover', width: THUMBNAIL_WIDTH, height: THUMBNAIL_HEIGHT },
    convert: 'image/webp',
  }, env);
}

export async function retryUncompressedImages(
  db: D1Database,
  media: R2Bucket,
  apiKey: string
): Promise<void> {
  const uncompressed = await db.prepare(
    `SELECT id, r2_key, updated_at FROM product_images
     WHERE is_compressed = 0
     ORDER BY updated_at ASC
     LIMIT 5`
  ).bind().all<{ id: string; r2_key: string; updated_at: string }>();

  if (!uncompressed.results || uncompressed.results.length === 0) return;

  for (const img of uncompressed.results) {
    const obj = await media.get(img.r2_key);
    if (!obj) continue;

    const original = await obj.arrayBuffer();
    const result = await compressImage(original, apiKey, { DB: db });

    if (result.ok) {
      const downloaded = await downloadCompressed(result.locationUrl, apiKey, { DB: db });
      if (downloaded.ok) {
        await media.put(img.r2_key, downloaded.compressed);
        const now = nowSql();
        await db.prepare(
          `UPDATE product_images SET is_compressed = 1, updated_at = ?2 WHERE id = ?1`
        ).bind(img.id, now).run();
      }
    }
  }
}
