import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { isPwaNetworkOnlyPath, PWA_NETWORK_ONLY_PATTERNS } from '../src/lib/pwa/constants';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('PWA manifest', () => {
  it('includes required installability fields and PNG icons', () => {
    const manifest = JSON.parse(read('public/manifest.json'));
    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBe('#faf9f7');
    expect(manifest.icons.some((i: { src: string }) => i.src.includes('/icons/icon-512.png'))).toBe(true);
    expect(manifest.icons.some((i: { purpose: string }) => i.purpose === 'maskable')).toBe(true);
  });
});

describe('PWA service worker', () => {
  it('exists and uses e-commerce-safe network-only rules', () => {
    expect(existsSync('public/sw.js')).toBe(true);
    const sw = read('public/sw.js');
    expect(sw).toContain('NETWORK_ONLY');
    expect(sw).toContain('/api');
    expect(sw).toContain('/checkout');
    expect(sw).toContain('/staff');
    expect(sw).not.toMatch(/caches\.put\(request.*mode === 'navigate'/);
    expect(sw).toContain('/offline.html');
    expect(sw).not.toContain('__SW_VERSION__');
  });

  it('template is regenerated with a unique build version', () => {
    expect(read('src/pwa/sw.template.js')).toContain('__SW_VERSION__');
  });
});

describe('PWA storefront wiring', () => {
  it('links manifest and registers SW from RootLayout only', () => {
    const layout = read('src/layouts/RootLayout.astro');
    expect(layout).toContain('rel="manifest"');
    expect(layout).toContain('registerServiceWorker');
    expect(layout).toContain('PwaInstallHint');
    const staff = read('src/layouts/StaffLayout.astro');
    expect(staff).not.toContain('registerServiceWorker');
  });

  it('allows service workers in CSP', () => {
    expect(read('src/middleware.ts')).toContain("worker-src 'self'");
  });
});

describe('PWA network-only path guard', () => {
  it('marks commerce-sensitive routes as network-only', () => {
    for (const path of ['/api/checkout', '/checkout', '/orders', '/staff/login', '/buy-now/saree']) {
      expect(isPwaNetworkOnlyPath(path), path).toBe(true);
    }
    expect(isPwaNetworkOnlyPath('/')).toBe(false);
    expect(isPwaNetworkOnlyPath('/about')).toBe(false);
    expect(PWA_NETWORK_ONLY_PATTERNS.length).toBeGreaterThanOrEqual(7);
  });
});