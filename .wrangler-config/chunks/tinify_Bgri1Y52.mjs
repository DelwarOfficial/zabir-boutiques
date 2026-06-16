globalThis.process ??= {};
globalThis.process.env ??= {};
function basicAuth(apiKey) {
  return `Basic ${btoa(`api:${apiKey}`)}`;
}
function nowSql() {
  return (/* @__PURE__ */ new Date()).toISOString().replace("T", " ").slice(0, 19);
}
async function compressImage(imageBuffer, apiKey) {
  const inputSize = imageBuffer.byteLength;
  try {
    const res = await fetch("https://api.tinify.com/shrink", {
      method: "POST",
      headers: {
        Authorization: basicAuth(apiKey),
        "Content-Type": "application/octet-stream"
      },
      body: imageBuffer
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { ok: false, error: `Tinify HTTP ${res.status}: ${body?.message ?? res.statusText}` };
    }
    const locationUrl = res.headers.get("Location");
    if (!locationUrl) return { ok: false, error: "No Location header from Tinify" };
    const data = await res.json();
    return {
      ok: true,
      compressed: imageBuffer,
      locationUrl,
      inputSize: data.input?.size ?? inputSize,
      outputSize: data.output?.size ?? inputSize,
      contentType: data.output?.type ?? "application/octet-stream"
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown Tinify error" };
  }
}
async function downloadCompressed(locationUrl, apiKey) {
  try {
    const res = await fetch(locationUrl, {
      headers: { Authorization: basicAuth(apiKey) }
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
      contentType: res.headers.get("Content-Type") ?? "application/octet-stream"
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown Tinify download error" };
  }
}
async function processImage(locationUrl, apiKey, options = {}) {
  const body = {};
  if (options.resize) {
    body.resize = options.resize;
  }
  if (options.convert) {
    body.convert = { type: options.convert };
  }
  try {
    const res = await fetch(locationUrl, {
      method: "POST",
      headers: {
        Authorization: basicAuth(apiKey),
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      return { ok: false, error: `Tinify process HTTP ${res.status}` };
    }
    return {
      ok: true,
      data: await res.arrayBuffer(),
      contentType: res.headers.get("Content-Type") ?? "image/webp"
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Unknown Tinify process error" };
  }
}
const THUMBNAIL_SUFFIX = "_thumb.webp";
const THUMBNAIL_WIDTH = 300;
const THUMBNAIL_HEIGHT = 300;
function thumbnailR2Key(fullR2Key) {
  const base = fullR2Key.replace(/\.[^.]+$/, "");
  return `${base}${THUMBNAIL_SUFFIX}`;
}
async function generateThumbnail(locationUrl, apiKey) {
  return processImage(locationUrl, apiKey, {
    resize: { method: "cover", width: THUMBNAIL_WIDTH, height: THUMBNAIL_HEIGHT },
    convert: "image/webp"
  });
}
async function retryUncompressedImages(db, media, apiKey) {
  const uncompressed = await db.prepare(
    `SELECT id, r2_key, updated_at FROM product_images
     WHERE is_compressed = 0
     ORDER BY updated_at ASC
     LIMIT 5`
  ).bind().all();
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
export {
  THUMBNAIL_HEIGHT,
  THUMBNAIL_SUFFIX,
  THUMBNAIL_WIDTH,
  compressImage,
  downloadCompressed,
  generateThumbnail,
  processImage,
  retryUncompressedImages,
  thumbnailR2Key
};
