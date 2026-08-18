/**
 * GET /api/staff/orders/labels?ids=a,b,c — Batch Shipping Labels
 *
 * Renders one label per order into a single printable A4 document, three
 * labels to a sheet (each 210mm x 99mm, matching the single-label route).
 * Reuses renderLabel() from the courier integration so a batch label is
 * byte-identical to the one produced by /orders/:id/label — a divergence
 * there would mean couriers scanning two different formats for the same
 * order depending on which button staff pressed.
 *
 * ?courier=pathao|steadfast|redx selects a courier template, as on the
 * single-label route. RBAC: requires orders.view.
 */
import type { APIContext } from 'astro';
import { getEnv } from '../../../../lib/env';
import { requireAuth, requirePermission, RbacError } from '../../../../lib/rbac';
import { renderLabel, validateProvider } from '../../../../lib/integrations/courier/index';
import type { LabelData } from '../../../../lib/integrations/courier/types';

const MAX_LABELS = 60;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function GET(context: APIContext): Promise<Response> {
  const env = getEnv(context);

  let user;
  try {
    user = await requireAuth(context);
    requirePermission(user, 'orders.view');
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }

  const q = new URL(context.request.url).searchParams;
  const ids = (q.get('ids') ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);

  if (ids.length === 0) {
    return Response.json({ error: 'No order IDs supplied' }, { status: 400 });
  }
  if (ids.length > MAX_LABELS) {
    // A print job this large is almost certainly a mistake, and rendering it
    // would block the request while building megabytes of HTML.
    return Response.json({ error: `Too many orders (max ${MAX_LABELS})` }, { status: 400 });
  }

  const placeholders = ids.map((_, i) => `?${i + 1}`).join(',');
  const result = await env.DB.prepare(
    `SELECT id, order_number, name, phone, address, payment_method, total_paisa,
            advance_paisa, balance_paisa, status, payment_status
     FROM orders WHERE id IN (${placeholders})`,
  ).bind(...ids).all<{
    id: string; order_number: string; name: string; phone: string; address: string;
    payment_method: string; total_paisa: number; advance_paisa: number;
    balance_paisa: number; status: string; payment_status: string;
  }>();

  const orders = result.results ?? [];
  if (orders.length === 0) {
    return Response.json({ error: 'No matching orders found' }, { status: 404 });
  }

  const provider = validateProvider(q.get('courier') || 'generic');

  // Preserve the order the caller listed the IDs in, so the printed stack
  // matches the on-screen selection rather than D1's row order.
  const byId = new Map(orders.map((o) => [o.id, o]));
  const ordered = ids.map((id) => byId.get(id)).filter((o): o is NonNullable<typeof o> => Boolean(o));

  const sections = ordered.map((order) => {
    const labelData: LabelData = {
      orderNumber: order.order_number,
      customerName: order.name,
      customerPhone: order.phone,
      customerAddress: order.address,
      paymentMethod: order.payment_method,
      totalPaisa: order.total_paisa,
      advancePaisa: order.advance_paisa,
      balancePaisa: order.balance_paisa,
      paymentStatus: order.payment_status,
      storeName: 'Zabir Boutiques',
      storeAddress: 'Wari, Dhaka',
      storePhone: '+880 1985-516000',
    };

    if (provider) {
      // renderLabel returns a full HTML document; take only its <body>
      // contents so the labels stack inside this single print document.
      const rendered = renderLabel(provider, labelData, false).html;
      const body = rendered.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      return `<div class="label">${body ? body[1] : rendered}</div>`;
    }

    let paymentLabel = 'COD';
    if (order.payment_method === 'in_store') paymentLabel = 'PAID (In-Store)';
    else if (order.payment_method === 'uddoktapay' && order.payment_status === 'paid') paymentLabel = 'PAID (Online)';
    else if (order.advance_paisa > 0 && order.balance_paisa > 0) {
      paymentLabel = `PARTIALLY PAID (৳${Math.floor(order.advance_paisa / 100)} paid, ৳${Math.floor(order.balance_paisa / 100)} COD)`;
    } else if (order.payment_method === 'uddoktapay') paymentLabel = 'PENDING PAYMENT';

    return `<div class="label">
      <div class="hdr">
        <div class="store">Zabir Boutiques</div>
        <div class="ord">${escapeHtml(order.order_number)}</div>
      </div>
      <div class="to">
        <div class="nm">${escapeHtml(order.name)}</div>
        <div class="ph">${escapeHtml(order.phone)}</div>
        <div class="ad">${escapeHtml(order.address)}</div>
      </div>
      <div class="ftr">
        <div class="pay">${escapeHtml(paymentLabel)}</div>
        <div class="tot">৳${Math.floor(order.total_paisa / 100)}</div>
      </div>
    </div>`;
  });

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Labels (${ordered.length})</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; }
  .label {
    width: 210mm; height: 99mm; padding: 8mm;
    border-bottom: 1px dashed #999;
    display: flex; flex-direction: column; justify-content: space-between;
    page-break-inside: avoid; break-inside: avoid;
  }
  /* Three 99mm labels fill a 297mm A4 sheet; force a break after each third. */
  .label:nth-child(3n) { page-break-after: always; break-after: page; border-bottom: none; }
  .hdr { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #000; padding-bottom: 3mm; }
  .store { font-size: 16pt; font-weight: 700; }
  .ord { font-size: 13pt; font-weight: 700; font-family: monospace; }
  .to { flex: 1; padding: 4mm 0; }
  .nm { font-size: 14pt; font-weight: 700; }
  .ph { font-size: 12pt; font-family: monospace; margin-top: 1mm; }
  .ad { font-size: 11pt; margin-top: 2mm; line-height: 1.4; }
  .ftr { display: flex; justify-content: space-between; align-items: center; border-top: 1px solid #000; padding-top: 3mm; }
  .pay { font-size: 11pt; font-weight: 700; }
  .tot { font-size: 16pt; font-weight: 700; }
  @media screen { body { background: #eee; } .label { background: #fff; margin: 4mm auto; } }
</style>
</head>
<body onload="window.print()">
${sections.join('\n')}
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `inline; filename="labels-${ordered.length}.html"`,
    },
  });
}
