import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PUBLIC_PAGES_DIR = join(process.cwd(), 'src/pages');
const LAYOUT_SHELL_FILES = [
  join(process.cwd(), 'src/layouts/RootLayout.astro'),
  join(process.cwd(), 'src/components/shell/Header.astro'),
];

const ISLAND_RE = /client:(load|idle|visible|only)(?:="[^"]+")?/g;
const MAX_ISLANDS = 5;

function listPublicPageFiles(dir: string, base = ''): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    if (entry === 'staff' || entry === 'api') continue;
    const full = join(dir, entry);
    const rel = join(base, entry);
    if (statSync(full).isDirectory()) {
      files.push(...listPublicPageFiles(full, rel));
    } else if (entry.endsWith('.astro')) {
      files.push(rel);
    }
  }
  return files;
}

function countIslands(source: string): number {
  return (source.match(ISLAND_RE) ?? []).length;
}

describe('public page React island budget [Master Plan §5.1]', () => {
  const pageFiles = listPublicPageFiles(PUBLIC_PAGES_DIR);

  it('discovers storefront pages under src/pages (excluding staff/api)', () => {
    expect(pageFiles.length).toBeGreaterThan(0);
    expect(pageFiles).toContain('index.astro');
    expect(pageFiles).toContain('checkout.astro');
  });

  for (const pageFile of pageFiles) {
    it(`${pageFile} hydrates at most ${MAX_ISLANDS} islands`, () => {
      const pageSource = readFileSync(join(PUBLIC_PAGES_DIR, pageFile), 'utf8');
      const shellIslands = LAYOUT_SHELL_FILES.reduce((sum, file) => sum + countIslands(readFileSync(file, 'utf8')), 0);
      const pageIslands = countIslands(pageSource);
      expect(pageIslands + shellIslands).toBeLessThanOrEqual(MAX_ISLANDS);
    });
  }

  it('checkout uses client:load for GuestCheckout', () => {
    const checkout = readFileSync(join(PUBLIC_PAGES_DIR, 'checkout.astro'), 'utf8');
    expect(checkout).toMatch(/GuestCheckout\s+client:load/);
  });

  it('ProductCard uses client:idle for AddToCartButton', () => {
    const card = readFileSync(join(process.cwd(), 'src/components/product/ProductCard.astro'), 'utf8');
    expect(card).toMatch(/AddToCartButton[\s\S]*client:idle/);
    expect(card).not.toMatch(/client:visible/);
  });
});