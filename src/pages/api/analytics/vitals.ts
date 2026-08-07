import type { APIContext } from 'astro';
import { trackMetric } from '../../../lib/analytics';

export async function POST(context: APIContext): Promise<Response> {
  try {
    const body: any = await context.request.json();
    const name = typeof body.name === 'string' ? body.name : 'unknown';
    const value = typeof body.value === 'number' ? body.value : 0;
    const rating = typeof body.rating === 'string' ? body.rating : 'unknown';
    const page = typeof body.page === 'string' ? body.page : 'unknown';

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
