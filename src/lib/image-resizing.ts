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

export const CDN_ORIGIN = "https://cdn.zabirboutiques.com";

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

const CARD_SIZES = "(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 400px";
const DETAIL_SIZES = "(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 800px";
const THUMB_SIZES = "96px";

const VARIANT_DIMS: Record<Exclude<ImageVariant, "og" | "zoom">, { width: number; height: number; sizes: string }> = {
  thumbnail: { width: 150, height: 188, sizes: THUMB_SIZES },
  card: { width: 400, height: 500, sizes: CARD_SIZES },
  detail: { width: 800, height: 1000, sizes: DETAIL_SIZES },
};

/** Resolve CDN origin (production custom domain; same-origin fallback for local previews). */
export function resolveCdnOrigin(siteOrigin?: string): string {
  return CDN_ORIGIN || siteOrigin?.replace(/\/$/, "") || "";
}

/**
 * Extract the R2 object key from snapshot URLs, absolute CDN URLs, or bare keys.
 * Returns null for static /assets placeholders and SVGs (no Image Resizing).
 */
export function extractR2KeyFromImageUrl(imageUrl: string): string | null {
  if (!imageUrl || imageUrl.startsWith("/assets/") || imageUrl.endsWith(".svg")) return null;

  let path = imageUrl;
  if (imageUrl.startsWith("http")) {
    try {
      path = new URL(imageUrl).pathname;
    } catch {
      return null;
    }
  }

  const resized = path.match(/\/cdn-cgi\/image\/[^/]+\/(.+)$/);
  if (resized) return decodeURIComponent(resized[1]);

  const bare = path.replace(/^\//, "");
  if (/^(?:products|media)\//.test(bare)) return bare;

  return null;
}

export type ProductImageLayout = "thumbnail" | "card" | "detail";

export type ProductImageAttrs = {
  src: string;
  srcset?: string;
  srcsetAvif?: string;
  sizes?: string;
  width: number;
  height: number;
  resizable: boolean;
};

/** Build responsive img attributes for catalog/product surfaces. */
export function productImageAttrs(
  productImageUrl: string,
  layout: ProductImageLayout = "card",
  opts: { siteOrigin?: string; sizes?: string } = {},
): ProductImageAttrs {
  const dims = VARIANT_DIMS[layout];
  const r2Key = extractR2KeyFromImageUrl(productImageUrl);
  const cdnOrigin = resolveCdnOrigin(opts.siteOrigin);

  if (!r2Key) {
    return {
      src: productImageUrl,
      srcset: `${productImageUrl} ${dims.width}w`,
      sizes: opts.sizes ?? dims.sizes,
      width: dims.width,
      height: dims.height,
      resizable: false,
    };
  }

  return {
    src: imageUrl(cdnOrigin, r2Key, layout, "webp"),
    srcset: imageSrcset(cdnOrigin, r2Key, "webp"),
    srcsetAvif: imageSrcset(cdnOrigin, r2Key, "avif"),
    sizes: opts.sizes ?? dims.sizes,
    width: dims.width,
    height: dims.height,
    resizable: true,
  };
}

/** Open Graph image URL (1200×630 JPEG) for social previews. */
export function ogImageFromProduct(productImageUrl: string, siteOrigin?: string): string {
  const r2Key = extractR2KeyFromImageUrl(productImageUrl);
  if (!r2Key) {
    if (productImageUrl.startsWith("http")) return productImageUrl;
    const origin = (siteOrigin ?? "https://zabirboutiques.com").replace(/\/$/, "");
    return `${origin}${productImageUrl.startsWith("/") ? productImageUrl : `/${productImageUrl}`}`;
  }
  return imageUrl(resolveCdnOrigin(siteOrigin), r2Key, "og", "jpeg");
}
