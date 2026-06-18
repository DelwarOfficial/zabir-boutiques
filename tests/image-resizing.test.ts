import { describe, it, expect } from 'vitest';
import {
  CDN_ORIGIN,
  extractR2KeyFromImageUrl,
  imageSrcset,
  imageUrl,
  ogImageFromProduct,
  productImageAttrs,
} from '../src/lib/image-resizing';

const R2_KEY = 'products/saree-01/main.jpg';

describe('image-resizing helpers', () => {
  it('imageUrl builds /cdn-cgi/image/ paths for all variants', () => {
    expect(imageUrl(CDN_ORIGIN, R2_KEY, 'thumbnail', 'webp')).toContain('/cdn-cgi/image/');
    expect(imageUrl(CDN_ORIGIN, R2_KEY, 'thumbnail', 'webp')).toContain('width=150');
    expect(imageUrl(CDN_ORIGIN, R2_KEY, 'og', 'jpeg')).toContain('width=1200');
    expect(imageUrl(CDN_ORIGIN, R2_KEY, 'og', 'jpeg')).toContain('height=630');
  });

  it('imageSrcset covers 150/400/800/1600 widths', () => {
    const srcset = imageSrcset(CDN_ORIGIN, R2_KEY, 'webp');
    expect(srcset).toContain('150w');
    expect(srcset).toContain('400w');
    expect(srcset).toContain('800w');
    expect(srcset).toContain('1600w');
    expect(srcset).toContain('format=webp');
  });

  it('extractR2KeyFromImageUrl parses snapshot and CDN URLs', () => {
    expect(extractR2KeyFromImageUrl(`/cdn-cgi/image/fit=cover,width=512/${R2_KEY}`)).toBe(R2_KEY);
    expect(extractR2KeyFromImageUrl(`https://cdn.zabirboutiques.com/cdn-cgi/image/width=400/${R2_KEY}`)).toBe(R2_KEY);
    expect(extractR2KeyFromImageUrl(`/${R2_KEY}`)).toBe(R2_KEY);
  });

  it('extractR2KeyFromImageUrl returns null for static SVG assets', () => {
    expect(extractR2KeyFromImageUrl('/assets/product-pakistani.svg')).toBeNull();
    expect(extractR2KeyFromImageUrl('/assets/zabir-logo.jpg')).toBeNull();
  });

  it('productImageAttrs emits srcset for R2-backed images', () => {
    const attrs = productImageAttrs(`/cdn-cgi/image/fit=cover,width=512/${R2_KEY}`, 'detail');
    expect(attrs.resizable).toBe(true);
    expect(attrs.srcset).toContain('800w');
    expect(attrs.srcsetAvif).toContain('format=avif');
    expect(attrs.sizes).toContain('100vw');
  });

  it('productImageAttrs falls back for demo placeholders', () => {
    const attrs = productImageAttrs('/assets/product-pakistani.svg', 'card');
    expect(attrs.resizable).toBe(false);
    expect(attrs.src).toBe('/assets/product-pakistani.svg');
    expect(attrs.srcset).toContain('400w');
  });

  it('ogImageFromProduct uses 1200x630 for R2 images', () => {
    const og = ogImageFromProduct(`/cdn-cgi/image/fit=cover,width=512/${R2_KEY}`);
    expect(og).toContain('width=1200');
    expect(og).toContain('height=630');
  });
});