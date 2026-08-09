import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('K-14: DirectCheckoutSessionDO rejects empty binding secrets', () => {
  const src = readFileSync(resolve('./src/do/direct-checkout-session-do.ts'), 'utf8');

  it('create rejects a missing/empty bindingSecret before storing', () => {
    const createBlock = src.slice(src.indexOf("case 'create':"), src.indexOf("case 'get':"));
    expect(createBlock).toContain('if (!body.bindingSecret)');
    expect(createBlock).toContain('MISSING_BINDING_SECRET');
  });

  it('verifySessionBinding rejects an omitted secret and the sha256(\'\') constant', () => {
    const verifyBlock = src.slice(src.indexOf('async function verifySessionBinding'));
    expect(verifyBlock).toContain('if (!bindingSecret) return false');
    expect(verifyBlock).toContain('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
