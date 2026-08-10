import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { collectStyleAttrHashes } from '../scripts/csp-hashes-plugin.mjs';
import { getCspStyleHashes, getCspStyleHashesVersion } from '../src/lib/csp-hashes';
import { generatePublicCSP, generateStaffCSP } from '../src/lib/security/csp';

function sha256Base64(value: string): string {
  return "'sha256-" + createHash('sha256').update(Buffer.from(value, 'utf8')).digest('base64') + "'";
}

const SCRATCH = resolve('./tests/.scratch-csp-style');

describe('N-13: static style-attribute hash collection', () => {
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

  it('the build plugin writes CSP_STYLE_HASHES alongside CSP_SCRIPT_HASHES into the same generated module', () => {
    const src = readFileSync(resolve('./scripts/csp-hashes-plugin.mjs'), 'utf8');
    expect(src).toContain('CSP_STYLE_HASHES');
    expect(src).toContain('buildStyleHashes');
  });
});

describe('N-13 phase 2 cutover: style-src drops unsafe-inline in production, keeps it in local dev', () => {
  const styleHashes = ["'sha256-fakehash1='", "'sha256-fakehash2='"];

  it('generatePublicCSP: production style-src has no unsafe-inline, includes unsafe-hashes and every provided hash', () => {
    const csp = generatePublicCSP('nonce123', false, [], styleHashes);
    const styleSrc = csp.split('; ').find(d => d.startsWith('style-src'));
    expect(styleSrc).toBeTruthy();
    expect(styleSrc).not.toContain('unsafe-inline');
    expect(styleSrc).toContain("'unsafe-hashes'");
    expect(styleSrc).toContain("'self'");
    for (const h of styleHashes) expect(styleSrc).toContain(h);
  });

  it('generateStaffCSP: same cutover applies to the staff CSP', () => {
    const csp = generateStaffCSP('nonce123', false, [], styleHashes);
    const styleSrc = csp.split('; ').find(d => d.startsWith('style-src'));
    expect(styleSrc).not.toContain('unsafe-inline');
    expect(styleSrc).toContain("'unsafe-hashes'");
    for (const h of styleHashes) expect(styleSrc).toContain(h);
  });

  it('local dev keeps unsafe-inline (Vite HMR can inject inline styles outside the hash list) and does not need the hash list', () => {
    const publicCsp = generatePublicCSP('nonce123', true, [], styleHashes);
    const staffCsp = generateStaffCSP('nonce123', true, [], styleHashes);
    for (const csp of [publicCsp, staffCsp]) {
      const styleSrc = csp.split('; ').find(d => d.startsWith('style-src'));
      expect(styleSrc).toBe("style-src 'self' 'unsafe-inline'");
    }
  });

  it('an empty style hash list still produces a well-formed style-src (defaults to [] via the function signature)', () => {
    const csp = generatePublicCSP('nonce123', false, []);
    const styleSrc = csp.split('; ').find(d => d.startsWith('style-src'));
    expect(styleSrc).toBe("style-src 'self' 'unsafe-hashes'");
  });

  it('middleware.ts wires getCspStyleHashes() into both generatePublicCSP and generateStaffCSP calls', () => {
    const src = readFileSync(resolve('./src/middleware.ts'), 'utf8');
    expect(src).toContain('getCspStyleHashes');
    expect(src).toContain('generateStaffCSP(nonce, localDev, scriptHashes, styleHashes)');
    expect(src).toContain('generatePublicCSP(nonce, localDev, scriptHashes, styleHashes)');
  });

  it('the live production style-src actually contains every hash currently generated from source — real cutover, not a stub list', () => {
    const csp = generatePublicCSP('nonce123', false, [], [...getCspStyleHashes()]);
    const styleSrc = csp.split('; ').find(d => d.startsWith('style-src'))!;
    for (const h of getCspStyleHashes()) {
      expect(styleSrc).toContain(h);
    }
  });
});
