/**
 * Cloudflare Image Resizing [Master_Prompt v7.0 §14.2, §3.3]
 *
 * Generates the /cdn-cgi/image/ URL for a variant on R2. Variants
 * are pre-defined per the spec:
 *   thumbnail  150px
 *   card       400px
 *   detail     800px
 *   zoom       1600px
 *   og         1200x630 (JPEG only)
 *
 * Format negotiation: pass `format=webp` or `format=avif`. JPEG is
 * the default fallback. Sizing is auto-derived from the variant.
 *
 * The cdn.zabirboutiques.com custom domain is configured in Cloudflare
 * to map to the R2 MEDIA bucket; Image Resizing is enabled for that
 * zone.
 */

export const IMAGE_VARIANTS = {
  thumbnail: { width: 150, quality: 75, fit: "cover" as const },
  card:      { width: 400, quality: 80, fit: "cover" as const },
  detail:    { width: 800, quality: 85, fit: "cover" as const },
  zoom:      { width: 1600, quality: 90, fit: "cover" as const },
  og:        { width: 1200, height: 630, quality: 85, fit: "cover" as const, format: "jpeg" as const },
};

export type ImageVariant = keyof typeof IMAGE_VARIANTS;

export function imageUrl(
  baseUrl: string,
  r2Key: string,
  variant: ImageVariant,
  format: "webp" | "avif" | "jpeg" | "auto" = "auto",
): string {
  const v = IMAGE_VARIANTS[variant];
  const useFormat = format === "auto" ? (v as { format?: string }).format ?? "auto" : format;
  const params = new URLSearchParams();
  if (v.width) params.set("width", String(v.width));
  if ("height" in v && v.height) params.set("height", String(v.height));
  params.set("quality", String(v.quality));
  if (v.fit) params.set("fit", v.fit);
  params.set("format", useFormat);
  // baseUrl is the CDN origin (https://cdn.zabirboutiques.com). The r2Key
  // is appended; /cdn-cgi/image/ is the Image Resizing endpoint.
  return `${baseUrl.replace(/\/$/, "")}/cdn-cgi/image/${params.toString()}/${r2Key}`;
}

/** Build a srcset string covering the 4 content variants (excluding og). */
export function imageSrcset(baseUrl: string, r2Key: string, format: "webp" | "avif" | "auto" = "webp"): string {
  return ([
    ["150w", imageUrl(baseUrl, r2Key, "thumbnail", format)],
    ["400w", imageUrl(baseUrl, r2Key, "card", format)],
    ["800w", imageUrl(baseUrl, r2Key, "detail", format)],
    ["1600w", imageUrl(baseUrl, r2Key, "zoom", format)],
  ] as const).map(([w, u]) => `${u} ${w}`).join(", ");
}
