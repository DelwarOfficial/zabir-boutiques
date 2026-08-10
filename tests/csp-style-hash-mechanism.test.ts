import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { collectStyleAttrHashes } from '../scripts/csp-hashes-plugin.mjs';
import { getCspStyleHashes, getCspStyleHashesVersion } from '../src/lib/csp-hashes';

function sha256Base64(value: string): string {
  return "'sha256-" + createHash('sha256').update(Buffer.from(value, 'utf8')).digest('base64') + "'";
}

const SCRATCH = resolve('./tests/.scratch-csp-style');

describe('N-13 phase 1: static style-attribute hash collection (ship dark, not wired into live CSP yet)', () => {
  it('hashes a literal quoted style="..." attribute', () => {
    mkdirSync(SCRATCH, { recursive: true });
    writeFileSync(resolve(SCRATCH, 'a.astro'), '<div style="color:red;padding:4px"></div>');
    const hashes = collectStyleAttrHashes(SCRATCH);
    expect(hashes).toEqual([sha256Base64('color:red;padding:4px')]);
    rmSync(SCRATCH, { recursive: true, force: true });
  });

  it('hashes single-quoted style attributes too', () => {
    mkdirSync(SCRATCH, { recursive: true });
    writeFileSync(resolve(SCRATCH, 'a.astro'), "<div style='width:10px'></div>");
    const hashes = collectStyleAttrHashes(SCRATCH);
    expect(hashes).toEqual([sha256Base64('width:10px')]);
    rmSync(SCRATCH, { recursive: true, force: true });
  });

  it('does NOT match a dynamic style={...} expression — those are unhashable at build time', () => {
    mkdirSync(SCRATCH, { recursive: true });
    writeFileSync(resolve(SCRATCH, 'a.astro'), '<div style={`width:${w}px`}></div>');
    const hashes = collectStyleAttrHashes(SCRATCH);
    expect(hashes).toEqual([]);
    rmSync(SCRATCH, { recursive: true, force: true });
  });

  it('skips .tsx files entirely — React/JSX style props are always object expressions, never a hashable literal string', () => {
    mkdirSync(SCRATCH, { recursive: true });
    writeFileSync(resolve(SCRATCH, 'a.tsx'), '<div style={{color:"red"}}></div>');
    const hashes = collectStyleAttrHashes(SCRATCH);
    expect(hashes).toEqual([]);
    rmSync(SCRATCH, { recursive: true, force: true });
  });

  it('deduplicates identical style values across files, mirroring how script hashes are deduped', () => {
    mkdirSync(SCRATCH, { recursive: true });
    writeFileSync(resolve(SCRATCH, 'a.astro'), '<div style="display:none"></div>');
    writeFileSync(resolve(SCRATCH, 'b.astro'), '<span style="display:none"></span>');
    const hashes = new Set(collectStyleAttrHashes(SCRATCH));
    expect(hashes.size).toBe(1);
    rmSync(SCRATCH, { recursive: true, force: true });
  });

  it('the generated hash set matches what recomputing from current source produces (catches stale/unregenerated hashes)', () => {
    const dirs = ['src/pages', 'src/components', 'src/layouts', 'src/islands'];
    const recomputed = new Set<string>();
    for (const dir of dirs) {
      for (const h of collectStyleAttrHashes(resolve(dir))) recomputed.add(h);
    }
    const generated = new Set(getCspStyleHashes());
    expect(generated).toEqual(recomputed);
  });

  it('getCspStyleHashesVersion returns a non-empty version string', () => {
    expect(typeof getCspStyleHashesVersion()).toBe('string');
    expect(getCspStyleHashesVersion().length).toBeGreaterThan(0);
  });

  it('ship-dark invariant: src/lib/security/csp.ts does not consume the style hashes yet — style-src is unchanged this deploy', () => {
    const src = readFileSync(resolve('./src/lib/security/csp.ts'), 'utf8');
    expect(src).not.toContain('getCspStyleHashes');
    expect(src).not.toContain('unsafe-hashes');
    expect(src).toContain("style-src 'self' 'unsafe-inline'");
  });

  it('the build plugin writes CSP_STYLE_HASHES alongside CSP_SCRIPT_HASHES into the same generated module', () => {
    const src = readFileSync(resolve('./scripts/csp-hashes-plugin.mjs'), 'utf8');
    expect(src).toContain('CSP_STYLE_HASHES');
    expect(src).toContain('buildStyleHashes');
  });
});
