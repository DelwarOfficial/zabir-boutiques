import type { LabelData, LabelResult } from './types';
import { escapeHtml, qrSvg, paymentLabel } from './shared';

export function renderRedxLabel(data: LabelData, thermal: boolean): LabelResult {
  const w = thermal ? '101.6mm' : '210mm';
  const h = thermal ? '152.4mm' : '99mm';
  const totalTaka = `৳${Math.floor(data.totalPaisa / 100)}`;
  const trackingUrl = `https://redx.com.bd/tracking/${data.orderNumber}`;

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>Redx - ${escapeHtml(data.orderNumber)}</title>
<style>
  @page { size: ${w} ${h}; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, sans-serif; }
  .label { width: ${w}; height: ${h}; padding: 5mm; display: flex; flex-direction: column; }
  .header { display: flex; justify-content: space-between; align-items: center; border: 2px solid #E30613; border-radius: 2mm; padding: 2mm 4mm; margin-bottom: 3mm; }
  .brand { font-weight: 900; font-size: 16pt; color: #E30613; }
  .order-num { font-size: 11pt; font-weight: 700; font-family: monospace; background: #E30613; color: #fff; padding: 1mm 3mm; border-radius: 1mm; }
  .content { display: grid; grid-template-columns: 2fr 1fr; gap: 4mm; flex: 1; }
  .section-label { font-size: 7pt; font-weight: 700; text-transform: uppercase; color: #888; letter-spacing: 0.5mm; }
  .recipient .name { font-weight: 900; font-size: 14pt; margin: 1mm 0; }
  .recipient .phone { font-size: 13pt; font-weight: 700; color: #E30613; }
  .recipient .address { font-size: 10pt; line-height: 1.4; color: #333; margin-top: 1mm; }
  .sender { font-size: 9pt; color: #555; }
  .payment { font-size: 10pt; margin-top: 2mm; font-weight: 700; }
  .barcode { text-align: center; margin-top: auto; }
  .barcode svg { width: ${thermal ? '70' : '60'}px; height: ${thermal ? '70' : '60'}px; }
  .footer { border-top: 2px solid #E30613; padding-top: 2mm; font-size: 8pt; color: #E30613; display: flex; justify-content: space-between; margin-top: auto; }
  @media print { body { margin: 0; } .label { border: none; } }
</style></head><body>
<div class="label">
  <div class="header">
    <span class="brand">REDX</span>
    <span class="order-num">${escapeHtml(data.orderNumber)}</span>
  </div>
  <div class="content">
    <div class="recipient">
      <div class="section-label">Delivery Address</div>
      <div class="name">${escapeHtml(data.customerName)}</div>
      <div class="phone">${escapeHtml(data.customerPhone)}</div>
      <div class="address">${escapeHtml(data.customerAddress)}</div>
      <div class="payment">${escapeHtml(totalTaka)} — ${escapeHtml(paymentLabel(data))}</div>
    </div>
    <div style="display:flex;flex-direction:column;justify-content:space-between">
      <div class="sender">
        <div class="section-label">From</div>
        <div style="font-weight:700">${escapeHtml(data.storeName)}</div>
        <div>${escapeHtml(data.storeAddress)}</div>
        <div>${escapeHtml(data.storePhone)}</div>
      </div>
      <div class="barcode">${qrSvg(trackingUrl, 60)}</div>
    </div>
  </div>
  <div class="footer">
    <span>redx.com.bd</span>
    <span>${escapeHtml(data.orderNumber)}</span>
    <span>${trackingUrl}</span>
  </div>
</div>
<script>window.print();</script>
</body></html>`;

  return { html, filename: `redx-${data.orderNumber}.html` };
}
