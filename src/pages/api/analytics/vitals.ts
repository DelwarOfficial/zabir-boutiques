import type { APIContext } from 'astro';
import { trackMetric } from '../../../lib/analytics';

// N-24: this endpoint is unauthenticated by necessity (fires from every
// visitor's browser before any session exists) — closed-set validation on
// name/rating is the defense against garbage-string pollution of the
// Analytics Engine dataset, on top of the rate limit in middleware.ts.
const VALID_METRIC_NAMES = new Set(['CLS', 'FCP', 'FID', 'INP', 'LCP', 'TTFB']);
const VALID_RATINGS = new Set(['good', 'needs-improvement', 'poor']);

export async function POST(context: APIContext): Promise<Response> {
  try {
    const body: any = await context.request.json();
    const rawName = typeof body.name === 'string' ? body.name : '';
    const name = VALID_METRIC_NAMES.has(rawName) ? rawName : 'unknown';
    const value = typeof body.value === 'number' && Number.isFinite(body.value) ? Math.max(0, Math.min(body.value, 3_600_000)) : 0;
    const rawRating = typeof body.rating === 'string' ? body.rating : '';
    const rating = VALID_RATINGS.has(rawRating) ? rawRating : 'unknown';
    const page = typeof body.page === 'string' ? body.page.slice(0, 200) : 'unknown';

    trackMetric(context as any, {
      name: 'web_vital',
      indexes: [name, rating],
      doubles: { value_ms: value },
      blobs: [page],
    });

    return new Response(null, { status: 204 });
  } catch {
    return new Response(null, { status: 204 });
  }
}
