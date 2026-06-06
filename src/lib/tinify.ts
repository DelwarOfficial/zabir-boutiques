/**
 * Tinify + R2 Media Pipeline [v6.8A]
 * - Tinify is upload-time only.
 * - Always store original or fallback media in R2 even if compression fails.
 * - Record compression status in product_images.
 * - Retry uncompressed images via daily maintenance.
 * - Never block staff upload solely because Tinify is down.
 */

export async function compressImage(
  imageBuffer: ArrayBuffer,
  apiKey: string
): Promise<{ ok: true; compressed: ArrayBuffer } | { ok: false; error: string }> {
  try {
    const res = await fetch('https://api.tinify.com/shrink', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(`api:${apiKey}`)}`,
        'Content-Type': 'application/octet-stream'
      },
      body: imageBuffer
    });

    if (!res.ok) {
      return { ok: false, error: `Tinify HTTP ${res.status}` };
    }

    const data = await res.json() as any;
    const outputUrl = data?.output?.url;
    if (!outputUrl) return { ok: false, error: 'No output URL from Tinify' };

    const compressed = await fetch(outputUrl);
    if (!compressed.ok) return { ok: false, error: 'Failed to download compressed image' };

    return { ok: true, compressed: await compressed.arrayBuffer() };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown Tinify error' };
  }
}

/**
 * Retry uncompressed images. Called by daily maintenance cron.
 */
export async function retryUncompressedImages(
  db: D1Database,
  media: R2Bucket,
  apiKey: string
): Promise<void> {
  const uncompressed = await db.prepare(
    `SELECT id, r2_key FROM product_images WHERE is_compressed = 0 LIMIT 5`
  ).bind().all<{ id: string; r2_key: string }>();

  if (!uncompressed.results || uncompressed.results.length === 0) return;

  for (const img of uncompressed.results) {
    const obj = await media.get(img.r2_key);
    if (!obj) continue;

    const original = await obj.arrayBuffer();
    const result = await compressImage(original, apiKey);

    if (result.ok) {
      await media.put(img.r2_key, result.compressed);
      await db.prepare(
        `UPDATE product_images SET is_compressed = 1, updated_at = ?2 WHERE id = ?1`
      ).bind(img.id, new Date().toISOString().replace('T', ' ').slice(0, 19)).run();
    }
  }
}
