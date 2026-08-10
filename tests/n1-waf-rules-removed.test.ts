import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
// wrangler.jsonc has `//` comments (and string values containing `//`,
// e.g. "https://..."). Strip only genuine `//` line comments by tracking
// whether we're inside a JSON string literal, char by char.
function parseJsonc(text: string): unknown {
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (escaped) { escaped = false; }
      else if (ch === '\\') { escaped = true; }
      else if (ch === '"') { inString = false; }
      continue;
    }
    if (ch === '"') { inString = true; out += ch; continue; }
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    out += ch;
  }
  return JSON.parse(out);
}

interface DoBinding { name: string; class_name: string }
interface MigrationTag { tag: string; new_sqlite_classes?: string[]; deleted_classes?: string[] }
interface WranglerEnv {
  durable_objects?: { bindings: DoBinding[] };
  migrations?: MigrationTag[];
}
interface WranglerConfig extends WranglerEnv {
  env?: { staging?: WranglerEnv; dev?: WranglerEnv };
}

describe('N-1: WafRules Durable Object removed (zero call sites, dead binding)', () => {
  it('src/do/waf-rules.ts no longer exists', () => {
    expect(existsSync(resolve('./src/do/waf-rules.ts'))).toBe(false);
  });

  it('src/entry-cloudflare.ts no longer imports or exports WafRules', () => {
    const src = readFileSync(resolve('./src/entry-cloudflare.ts'), 'utf8');
    expect(src).not.toContain('WafRules');
    expect(src).not.toContain('waf-rules');
  });

  it('src/env.d.ts no longer declares WAF_RULES', () => {
    const src = readFileSync(resolve('./src/env.d.ts'), 'utf8');
    expect(src).not.toContain('WAF_RULES');
  });

  it('wrangler.jsonc: WAF_RULES binding removed from all three environments (default, staging, dev)', () => {
    const config = parseJsonc(readFileSync(resolve('./wrangler.jsonc'), 'utf8')) as WranglerConfig;

    const envs: WranglerEnv[] = [config, config.env!.staging!, config.env!.dev!];
    for (const env of envs) {
      const names = env.durable_objects!.bindings.map((b) => b.name);
      expect(names).not.toContain('WAF_RULES');
    }
  });

  it('wrangler.jsonc: v2 (already-published) migration tag is untouched — still lists WafRules in new_sqlite_classes', () => {
    const config = parseJsonc(readFileSync(resolve('./wrangler.jsonc'), 'utf8')) as WranglerConfig;
    const envs: WranglerEnv[] = [config, config.env!.staging!, config.env!.dev!];
    for (const env of envs) {
      const v2 = env.migrations!.find((m) => m.tag === 'v2');
      expect(v2?.new_sqlite_classes).toContain('WafRules');
    }
  });

  it('wrangler.jsonc: a new v5 deleted_classes migration removes WafRules, in every environment', () => {
    const config = parseJsonc(readFileSync(resolve('./wrangler.jsonc'), 'utf8')) as WranglerConfig;
    const envs: WranglerEnv[] = [config, config.env!.staging!, config.env!.dev!];
    for (const env of envs) {
      const v5 = env.migrations!.find((m) => m.tag === 'v5');
      expect(v5?.deleted_classes).toEqual(['WafRules']);
    }
  });

  it('wrangler.jsonc: migration tags remain contiguous and unique per environment', () => {
    const config = parseJsonc(readFileSync(resolve('./wrangler.jsonc'), 'utf8')) as WranglerConfig;
    const envs: WranglerEnv[] = [config, config.env!.staging!, config.env!.dev!];
    for (const env of envs) {
      const tags = env.migrations!.map((m) => m.tag);
      expect(tags).toEqual(['v1', 'v2', 'v3', 'v4', 'v5']);
    }
  });

  it('the remaining 7 Durable Object classes are still bound in every environment', () => {
    const config = parseJsonc(readFileSync(resolve('./wrangler.jsonc'), 'utf8')) as WranglerConfig;
    const envs: WranglerEnv[] = [config, config.env!.staging!, config.env!.dev!];
    const expected = [
      'VariantInventoryDO', 'IdempotencyDO', 'BudgetCounterDO', 'CartDO',
      'DirectCheckoutSessionDO', 'ProviderHealthDO', 'InvoiceCounterDO',
    ];
    for (const env of envs) {
      const classNames = env.durable_objects!.bindings.map((b) => b.class_name);
      expect(classNames.sort()).toEqual([...expected].sort());
    }
  });
});
