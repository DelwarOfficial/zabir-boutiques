/**
 * GET /api/staff/orders/:id/label — Shipping Label Generator [Staff Operations v2]
 *
 * Generates a downloadable shipping label as an SVG-in-HTML that can be
 * printed or screenshot. Returns HTML that auto-triggers print dialog.
 *
 * Dimensions: 210mm × 99mm (3 labels fit vertically on A4).
 * ?format=thermal: 4x6 inch (101.6mm × 152.4mm) for thermal printers.
 * ?courier=pathao|steadfast|redx: courier-specific label template.
 * ?courier=generic (default): plain store-branded label.
 *
 * RBAC: Requires orders.view permission.
 */
import type { APIContext } from 'astro';
import { getEnv } from '../../../../../lib/env';
import { requireAuth, requirePermission, RbacError } from '../../../../../lib/rbac';
import { renderLabel, validateProvider } from '../../../../../lib/integrations/courier/index';
import type { LabelData } from '../../../../../lib/integrations/courier/types';

export async function GET(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const orderId = context.params.id;
  if (!orderId) return Response.json({ error: 'Missing order ID' }, { status: 400 });

  let user;
  try {
    user = await requireAuth(context);
    requirePermission(user, 'orders.view');
  } catch (err) {
    if (err instanceof RbacError) return err.toResponse();
    throw err;
  }

  const order = await env.DB.prepare(
    `SELECT order_number, name, phone, address, payment_method, total_paisa,
            advance_paisa, balance_paisa, status, payment_status
     FROM orders WHERE id = ?1`
  ).bind(orderId).first<{
    order_number: string; name: string; phone: string; address: string;
    payment_method: string; total_paisa: number; advance_paisa: number;
    balance_paisa: number; status: string; payment_status: string;
  }>();

  if (!order) return Response.json({ error: 'Order not found' }, { status: 404 });

  const q = new URL(context.request.url).searchParams;
  const courierParam = q.get('courier') || 'generic';
  const thermal = q.get('format') === 'thermal';

  const provider = validateProvider(courierParam);

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
    const result = renderLabel(provider, labelData, thermal);
    return new Response(result.html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Disposition': `inline; filename="${result.filename}"`,
      },
    });
  }

  // Fallback: generic store-branded label
  let paymentLabel = 'COD';
  if (order.payment_method === 'in_store') paymentLabel = 'PAID (In-Store)';
  else if (order.payment_method === 'uddoktapay' && order.payment_status === 'paid') paymentLabel = 'PAID (Online)';
  else if (order.advance_paisa > 0 && order.balance_paisa > 0) paymentLabel = `PARTIALLY PAID (৳${Math.floor(order.advance_paisa / 100)} paid, ৳${Math.floor(order.balance_paisa / 100)} COD)`;
  else if (order.payment_method === 'uddoktapay') paymentLabel = 'PENDING PAYMENT';

  const totalTaka = `৳${Math.floor(order.total_paisa / 100)}`;
  const w = thermal ? '101.6mm' : '210mm';
  const h = thermal ? '152.4mm' : '99mm';

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Label - ${escapeHtml(order.order_number)}</title>
<style>
  @page { size: ${w} ${h}; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, sans-serif; }
  .label { width: ${w}; height: ${h}; padding: 6mm 8mm; border: 1px dashed #999; display: grid; grid-template-rows: auto 1fr auto; gap: 3mm; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 1px solid #333; padding-bottom: 3mm; }
  .brand { font-weight: 900; font-size: 14pt; }
  .order-num { font-size: 12pt; font-weight: 700; font-family: monospace; }
  .body { display: grid; grid-template-columns: 1fr auto; gap: 5mm; }
  .customer { font-size: 13pt; }
  .customer .name { font-weight: 900; font-size: 16pt; margin-bottom: 2mm; }
  .customer .phone { font-size: 14pt; font-weight: 700; margin-bottom: 2mm; }
  .customer .address { font-size: 11pt; line-height: 1.4; color: #333; }
  .payment-box { text-align: right; }
  .payment-box .total { font-size: 16pt; font-weight: 900; }
  .payment-box .status { font-size: 10pt; font-weight: 700; margin-top: 2mm; padding: 1mm 3mm; border: 1px solid #333; display: inline-block; }
  .footer { border-top: 1px solid #999; padding-top: 2mm; font-size: 9pt; color: #666; text-align: center; }
  @media print { body { margin: 0; } .label { border: none; } }
</style>
</head>
<body>
<div class="label">
  <div class="header">
    <span class="brand">ZABIR BOUTIQUES</span>
    <span class="order-num">${escapeHtml(order.order_number)}</span>
  </div>
  <div class="body">
    <div class="customer">
      <div class="name">${escapeHtml(order.name)}</div>
      <div class="phone">${escapeHtml(order.phone)}</div>
      <div class="address">${escapeHtml(order.address)}</div>
    </div>
    <div class="payment-box">
      <div class="total">${escapeHtml(totalTaka)}</div>
      <div class="status">${escapeHtml(paymentLabel)}</div>
    </div>
  </div>
  <div class="footer">Zabir Boutiques — Wari, Dhaka — +880 1985-516000</div>
</div>
<script>window.print();</script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `inline; filename="label-${order.order_number}.html"`,
    },
  });
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
