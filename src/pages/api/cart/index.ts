import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/env';
import { doGetCart } from '../../../lib/do-client';
import type { Paisa } from '../../../lib/money';

const SID_COOKIE = 'zb_cart_sid';
const SID_MAX_AGE = 30 * 24 * 60 * 60;

function readCartSessionId(request: Request): string | null {
  const raw = request.headers.get('cookie') ?? '';
  const match = raw.match(new RegExp(`(?:^|;\\s*)${SID_COOKIE}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function isLocalDev(request: Request): boolean {
  const host = request.headers.get('host') ?? '';
  return host.includes('localhost') || host.includes('127.0.0.1') || host.includes('0.0.0.0');
}

function setCartSessionCookie(response: Response, sid: string, request: Request): Response {
  const secure = isLocalDev(request) ? '' : ' Secure;';
  const setCookie = `${SID_COOKIE}=${encodeURIComponent(sid)}; HttpOnly;${secure} Path=/; Max-Age=${SID_MAX_AGE}; SameSite=Lax`;
  const existing = response.headers.get('Set-Cookie');
  response.headers.set('Set-Cookie', existing ? `${existing}, ${setCookie}` : setCookie);
  return response;
}

interface EnrichedItem {
  variantId: string;
  productId: string;
  title: string;
  imageUrl: string;
  variantLabel: string;
  unitPricePaisa: Paisa;
  quantity: number;
  availableQuantity?: number;
}

async function enrichItems(
  env: ReturnType<typeof getEnv>,
  items: Array<{ variantId: string; quantity: number }>,
): Promise<EnrichedItem[]> {
  if (items.length === 0) return [];
  const placeholders = items.map((_, i) => `?${i + 1}`).join(',');
  const variantIds = items.map((i) => i.variantId);
  const rows = await env.DB
    .prepare(
      `SELECT pv.id AS variant_id, pv.product_id, p.name AS title,
              CASE
                WHEN pv.size IS NOT NULL AND pv.color IS NOT NULL THEN pv.size || ', ' || pv.color
                WHEN pv.size IS NOT NULL THEN pv.size
                WHEN pv.color IS NOT NULL THEN pv.color
                ELSE pv.sku
              END AS variant_label,
              (SELECT pi.r2_key FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.sort_order LIMIT 1) AS image_url,
              pv.price_paisa, inv.quantity AS available_quantity
       FROM product_variants pv
       JOIN products p ON p.id = pv.product_id
       LEFT JOIN inventory_items inv ON inv.variant_id = pv.id
       WHERE pv.id IN (${placeholders})`,
    )
    .bind(...variantIds)
    .all<{
      variant_id: string;
      product_id: string;
      title: string;
      variant_label: string;
      image_url: string;
      price_paisa: number;
      available_quantity: number | null;
    }>();
  const map = new Map(rows.results?.map((r) => [r.variant_id, r]));
  return items.map((item) => {
    const row = map.get(item.variantId);
    return {
      variantId: item.variantId,
      productId: row?.product_id ?? '',
      title: row?.title ?? 'Unknown',
      imageUrl: row?.image_url ?? '',
      variantLabel: row?.variant_label ?? '',
      unitPricePaisa: (row?.price_paisa ?? 0) as Paisa,
      quantity: item.quantity,
      availableQuantity: row?.available_quantity ?? 0,
    };
  });
}

export async function GET(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const sessionId = readCartSessionId(context.request);
  if (!sessionId) {
    return Response.json({ ok: true, items: [] });
  }
  const cartState = await doGetCart(env, sessionId);
  if (!cartState || cartState.items.length === 0) {
    return Response.json({ ok: true, items: [] });
  }
  const items = await enrichItems(env, cartState.items);
  return Response.json({ ok: true, items });
}

export async function POST(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  let sessionId = readCartSessionId(context.request);
  const body = (await context.request.json().catch(() => ({}))) as {
    action?: string;
    variantId?: string;
    quantity?: number;
    couponCode?: string;
    customerContact?: string;
    items?: Array<{ variantId: string; quantity: number }>;
  };

  if (!sessionId && body.action && body.action !== 'get') {
    sessionId = crypto.randomUUID();
  }

  if (!env.CART_DO) {
    return Response.json({ ok: false, code: 'CART_DO_NOT_BOUND' }, { status: 503 });
  }

  const id = env.CART_DO.idFromName(sessionId!);
  const stub = env.CART_DO.get(id);

  const action = body.action ?? 'get';

  let cartResponse: Response;
  try {
    switch (action) {
      case 'add': {
        cartResponse = await stub.fetch('https://do/add', {
          method: 'POST',
          body: JSON.stringify({ variantId: body.variantId, quantity: body.quantity ?? 1 }),
        });
        break;
      }
      case 'remove': {
        cartResponse = await stub.fetch('https://do/remove', {
          method: 'POST',
          body: JSON.stringify({ variantId: body.variantId }),
        });
        break;
      }
      case 'quantity': {
        cartResponse = await stub.fetch('https://do/quantity', {
          method: 'POST',
          body: JSON.stringify({ variantId: body.variantId, quantity: body.quantity }),
        });
        break;
      }
      case 'clear': {
        cartResponse = await stub.fetch('https://do/clear', {
          method: 'POST',
          body: JSON.stringify({}),
        });
        break;
      }
      case 'replace_all': {
        // Clear existing, then add each
        await stub.fetch('https://do/clear', { method: 'POST', body: JSON.stringify({}) });
        if (Array.isArray(body.items)) {
          for (const item of body.items) {
            await stub.fetch('https://do/add', {
              method: 'POST',
              body: JSON.stringify({ variantId: item.variantId, quantity: item.quantity }),
            });
          }
        }
        cartResponse = await stub.fetch('https://do/get', { method: 'POST', body: JSON.stringify({}) });
        break;
      }
      default: {
        cartResponse = await stub.fetch('https://do/get', { method: 'POST', body: JSON.stringify({}) });
      }
    }
  } catch {
    return Response.json({ ok: false, code: 'CART_DO_ERROR' }, { status: 502 });
  }

  const cartData = (await cartResponse.json().catch(() => ({}))) as {
    ok?: boolean;
    cart?: { items: Array<{ variantId: string; quantity: number }> };
    error?: string;
  };

  if (!cartData.ok || !cartData.cart) {
    return Response.json(cartData, { status: 502 });
  }

  const items = await enrichItems(env, cartData.cart.items);

  let response = Response.json({ ok: true, items, sessionId });
  if (sessionId) {
    response = setCartSessionCookie(response, sessionId, context.request);
  }
  return response;
}
