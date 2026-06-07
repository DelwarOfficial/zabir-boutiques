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
  apiKey: string
): Promise<CompressResult> {
  const inputSize = imageBuffer.byteLength;
  try {
    const res = await fetch('https://api.tinify.com/shrink', {
      method: 'POST',
      headers: {
        Authorization: basicAuth(apiKey),
        'Content-Type': 'application/octet-stream',
      },
      body: imageBuffer,
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      return { ok: false, error: `Tinify HTTP ${res.status}: ${(body as any)?.message ?? res.statusText}` };
    }

    const locationUrl = res.headers.get('Location');
    if (!locationUrl) return { ok: false, error: 'No Location header from Tinify' };

    const data = (await res.json()) as {
      input?: { size?: number };
      output?: { size?: number; type?: string };
    };

    return {
      ok: true,
      compressed: imageBuffer,
      locationUrl,
      inputSize: data.input?.size ?? inputSize,
      outputSize: data.output?.size ?? inputSize,
      contentType: data.output?.type ?? 'application/octet-stream',
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown Tinify error' };
  }
}

export async function downloadCompressed(locationUrl: string, apiKey: string): Promise<CompressResult> {
  try {
    const res = await fetch(locationUrl, {
      headers: { Authorization: basicAuth(apiKey) },
    });
    if (!res.ok) {
      return { ok: false, error: `Tinify download HTTP ${res.status}` };
    }
    const compressed = await res.arrayBuffer();
    return {
      ok: true,
      compressed,
      locationUrl,
      inputSize: 0,
      outputSize: compressed.byteLength,
      contentType: res.headers.get('Content-Type') ?? 'application/octet-stream',
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown Tinify download error' };
  }
}

export async function processImage(
  locationUrl: string,
  apiKey: string,
  options: {
    resize?: ResizeOptions;
    convert?: ConvertTarget | ConvertTarget[] | '*/*';
  } = {}
): Promise<{ ok: true; data: ArrayBuffer; contentType: string } | { ok: false; error: string }> {
  const body: Record<string, unknown> = {};
  if (options.resize) {
    body.resize = options.resize;
  }
  if (options.convert) {
    body.convert = { type: options.convert };
  }

  try {
    const res = await fetch(locationUrl, {
      method: 'POST',
      headers: {
        Authorization: basicAuth(apiKey),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      return { ok: false, error: `Tinify process HTTP ${res.status}` };
    }

    return {
      ok: true,
      data: await res.arrayBuffer(),
      contentType: res.headers.get('Content-Type') ?? 'image/webp',
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown Tinify process error' };
  }
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
  apiKey: string
): Promise<{ ok: true; data: ArrayBuffer; contentType: string } | { ok: false; error: string }> {
  return processImage(locationUrl, apiKey, {
    resize: { method: 'cover', width: THUMBNAIL_WIDTH, height: THUMBNAIL_HEIGHT },
    convert: 'image/webp',
  });
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
    const result = await compressImage(original, apiKey);

    if (result.ok) {
      const downloaded = await downloadCompressed(result.locationUrl, apiKey);
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
