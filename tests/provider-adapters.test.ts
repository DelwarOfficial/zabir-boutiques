import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateProductContent } from '../src/lib/ai-content';
import { verifyTurnstile } from '../src/lib/turnstile';
import { purgeCacheTag } from '../src/lib/cache-api';
import { checkFraudBD } from '../src/lib/fraud';
import { verifyUddoktaPayment } from '../src/lib/payments';
import { compressImage } from '../src/lib/tinify';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AI adapters', () => {
  it('falls back to Workers AI when DeepSeek key is unavailable', async () => {
    const result = await generateProductContent(
      { name: 'Silk Saree' },
      {
        AI: {
          run: vi.fn().mockResolvedValue({ response: JSON.stringify({ description: 'Fallback description', metaTitle: 'Fallback title', metaDescription: 'Fallback meta' }) }),
        } as unknown as Ai,
      },
      'workers_ai',
    );

    expect(result.provider).toBe('workers_ai');
    expect(result.description).toContain('Fallback');
  });

  it('uses DeepSeek adapter when key exists', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        choices: [{ message: { content: JSON.stringify({ description: 'DeepSeek description', metaTitle: 'DeepSeek title', metaDescription: 'DeepSeek meta' }) } }],
        usage: { total_tokens: 42 },
      }),
    } as Response);

    const result = await generateProductContent({ name: 'Kurti' }, { DEEPSEEK_API_KEY: 'k' }, 'deepseek');
    expect(result.provider).toBe('deepseek');
    expect(result.tokens_used).toBe(42);
  });
});

describe('Turnstile adapter', () => {
  it('passes when secret is not configured', async () => {
    await expect(verifyTurnstile({}, 'token')).resolves.toEqual({ ok: true });
  });

  it('verifies token through Cloudflare adapter', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ok: true, hostname: 'example.com' }),
    } as Response);
    global.fetch = fetchMock;

    const result = await verifyTurnstile({ TURNSTILE_SECRET_KEY: 'secret' }, 'token-1', '127.0.0.1');
    expect(result.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0];
    expect(String((init as RequestInit).body)).toContain('response=token-1');
  });
});

describe('Cloudflare cache adapter', () => {
  it('purges tag through Cloudflare API', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response);
    global.fetch = fetchMock;

    await purgeCacheTag({ CF_API_TOKEN: 'token', CF_ZONE_ID: 'zone-1' }, 'product-123');

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/zones/zone-1/purge_cache');
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ tags: ['product-123'] });
  });
});

describe('FraudBD adapter', () => {
  it('returns score 50 when provider circuit is open', async () => {
    const stub = {
      fetch: vi.fn().mockResolvedValue({ json: () => Promise.resolve({ canProceed: false, state: 'open' }) }),
    };
    const env = {
      PROVIDER_HEALTH_DO: {
        idFromName: vi.fn().mockReturnValue('fraudbd'),
        get: vi.fn().mockReturnValue(stub),
      },
    } as unknown as { PROVIDER_HEALTH_DO: DurableObjectNamespace };

    const result = await checkFraudBD('01712345678', 'key', 1500, 'https://fraudbd.com', env);
    expect(result.score).toBe(50);
    expect(result.rawResponse).toContain('fallback_score');
  });
});

describe('UddoktaPay adapter', () => {
  it('verifies payment through the adapterized path', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: 'COMPLETED', amount: '200.00', invoice_id: 'inv-9', metadata: { order_id: 'ord-9' } }),
    } as Response);

    const result = await verifyUddoktaPayment('inv-9', 'key', 'https://uddoktapay.dev');
    expect(result.status).toBe('paid');
    expect(result.amountPaisa).toBe(20000);
  });
});

describe('Tinify adapter', () => {
  it('compresses images through the adapterized path', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ Location: 'https://tinify.dev/result' }),
      json: () => Promise.resolve({ input: { size: 10 }, output: { size: 5, type: 'image/webp' } }),
    } as Response);

    const result = await compressImage(new Uint8Array([1, 2, 3]).buffer, 'tinify-key');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.locationUrl).toBe('https://tinify.dev/result');
      expect(result.outputSize).toBe(5);
    }
  });
});
