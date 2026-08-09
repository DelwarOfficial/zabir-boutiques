import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('../src/lib/analytics', () => ({ trackMetric: vi.fn() }));

import { POST } from '../src/pages/api/analytics/vitals';
import { trackMetric } from '../src/lib/analytics';

function ctx(body: unknown) {
  return {
    request: new Request('https://x/api/analytics/vitals', { method: 'POST', body: JSON.stringify(body) }),
  } as any;
}

describe('N-24: analytics vitals endpoint validates name/rating against closed sets', () => {
  it('accepts a genuine Core Web Vitals payload unmodified', async () => {
    await POST(ctx({ name: 'LCP', value: 1234.5, rating: 'good', page: '/products/x' }));
    expect(trackMetric).toHaveBeenCalledWith(expect.anything(), {
      name: 'web_vital',
      indexes: ['LCP', 'good'],
      doubles: { value_ms: 1234.5 },
      blobs: ['/products/x'],
    });
  });

  it('coerces a garbage metric name to "unknown" instead of writing it verbatim', async () => {
    await POST(ctx({ name: '<script>alert(1)</script>', value: 1, rating: 'good', page: '/' }));
    expect(trackMetric).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ indexes: ['unknown', 'good'] }));
  });

  it('coerces a garbage rating to "unknown"', async () => {
    await POST(ctx({ name: 'LCP', value: 1, rating: 'nonsense-value', page: '/' }));
    expect(trackMetric).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ indexes: ['LCP', 'unknown'] }));
  });

  it('clamps an absurd value instead of writing it verbatim', async () => {
    await POST(ctx({ name: 'LCP', value: 999_999_999, rating: 'good', page: '/' }));
    expect(trackMetric).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ doubles: { value_ms: 3_600_000 } }));
  });

  it('middleware.ts rate-limits /api/analytics/vitals', () => {
    const src = readFileSync(resolve('./src/middleware.ts'), 'utf8');
    expect(src).toContain("pattern: /^\\/api\\/analytics\\/vitals$/");
  });
});
