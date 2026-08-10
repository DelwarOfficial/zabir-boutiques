import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { doCheckProviderHealth, doRecordProviderResult } from '../src/lib/do-client';

/**
 * N-2 Case A (ProviderHealthDO): object ID is `provider:{name}`. Safe as a
 * direct cutover (no hydrate needed) because ensureLoaded() never reads D1
 * on cold start — a freshly-addressed object just defaults to 'closed',
 * identical to what an ordinary DO eviction already produces today.
 */
function fakeNamespace() {
  const idFromName = vi.fn((name: string) => name);
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ canProceed: true, state: 'closed' })));
  const get = vi.fn((_name: string) => ({ fetch: fetchImpl }));
  return { idFromName, get, fetchImpl } as unknown as DurableObjectNamespace & { idFromName: any; get: any; fetchImpl: any };
}

describe('N-2 Case A: ProviderHealthDO object ID is provider:{name} at every do-client.ts call site', () => {
  it('doCheckProviderHealth', async () => {
    const ns = fakeNamespace();
    await doCheckProviderHealth({ PROVIDER_HEALTH_DO: ns } as never, 'deepseek');
    expect((ns as any).idFromName).toHaveBeenCalledWith('provider:deepseek');
  });

  it('doRecordProviderResult', async () => {
    const ns = fakeNamespace();
    await doRecordProviderResult({ PROVIDER_HEALTH_DO: ns } as never, 'deepseek', true);
    expect((ns as any).idFromName).toHaveBeenCalledWith('provider:deepseek');
  });

  it('two different providers never collide on the same object', async () => {
    const ns = fakeNamespace();
    await doCheckProviderHealth({ PROVIDER_HEALTH_DO: ns } as never, 'deepseek');
    await doCheckProviderHealth({ PROVIDER_HEALTH_DO: ns } as never, 'openai');
    const calls = (ns as any).idFromName.mock.calls.map((c: unknown[]) => c[0]);
    expect(calls).toEqual(['provider:deepseek', 'provider:openai']);
  });

  it('no PROVIDER_HEALTH_DO binding: fails open (canProceed true, closed) without touching idFromName', async () => {
    const result = await doCheckProviderHealth({} as never, 'deepseek');
    expect(result).toEqual({ canProceed: true, state: 'closed' });
  });

  it('DO source: ensureLoaded never reads D1 on cold start — direct cutover is safe, no hydrate needed', () => {
    const src = readFileSync(resolve('./src/do/provider-health-do.ts'), 'utf8');
    const ensureLoaded = src.slice(src.indexOf('private async ensureLoaded'), src.indexOf('private async ensureLoaded') + 600);
    expect(ensureLoaded).not.toContain('this.env.DB');
    expect(ensureLoaded).toContain("state: 'closed'");
  });
});
