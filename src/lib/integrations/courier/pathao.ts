import type { LabelData, LabelResult } from './types';
import { escapeHtml, qrSvg, paymentLabel } from './shared';

export function renderPathaoLabel(data: LabelData, thermal: boolean): LabelResult {
  const w = thermal ? '101.6mm' : '210mm';
  const h = thermal ? '152.4mm' : '99mm';
  const totalTaka = `৳${Math.floor(data.totalPaisa / 100)}`;
  const trackingUrl = `https://pathao.com/track?order=${data.orderNumber}`;

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>Pathao - ${escapeHtml(data.orderNumber)}</title>
<style>
  @page { size: ${w} ${h}; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, sans-serif; }
  .label { width: ${w}; height: ${h}; padding: 5mm; display: flex; flex-direction: column; position: relative; }
  .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #00A650; padding-bottom: 3mm; }
  .brand { font-weight: 900; font-size: 16pt; color: #00A650; }
  .order-num { font-size: 11pt; font-weight: 700; font-family: monospace; }
  .badge { background: #00A650; color: #fff; font-size: 8pt; font-weight: 700; padding: 1mm 3mm; border-radius: 2mm; }
  .grid { display: grid; grid-template-columns: 2fr 1fr; gap: 4mm; flex: 1; padding: 3mm 0; }
  .section-label { font-size: 7pt; font-weight: 700; text-transform: uppercase; color: #888; letter-spacing: 0.5mm; }
  .recipient .name { font-weight: 900; font-size: 14pt; margin: 1mm 0; }
  .recipient .phone { font-size: 13pt; font-weight: 700; }
  .recipient .address { font-size: 10pt; line-height: 1.4; color: #333; margin-top: 1mm; }
  .sender { font-size: 9pt; color: #555; }
  .qr { text-align: right; }
  .qr svg { width: ${thermal ? '60' : '50'}px; height: ${thermal ? '60' : '50'}px; }
  .footer { border-top: 1px solid #ddd; padding-top: 2mm; font-size: 8pt; color: #999; display: flex; justify-content: space-between; }
  @media print { body { margin: 0; } .label { border: none; } }
</style></head><body>
<div class="label">
  <div class="header">
    <span class="brand">Pathao</span>
    <span class="badge">${escapeHtml(data.orderNumber)}</span>
  </div>
  <div class="grid">
    <div class="recipient">
      <div class="section-label">Deliver To</div>
      <div class="name">${escapeHtml(data.customerName)}</div>
      <div class="phone">${escapeHtml(data.customerPhone)}</div>
      <div class="address">${escapeHtml(data.customerAddress)}</div>
      <div style="margin-top:2mm;font-size:10pt;font-weight:700">${escapeHtml(totalTaka)} — ${escapeHtml(paymentLabel(data))}</div>
    </div>
    <div style="display:flex;flex-direction:column;justify-content:space-between">
      <div class="sender">
        <div class="section-label">From</div>
        <div style="font-weight:700">${escapeHtml(data.storeName)}</div>
        <div>${escapeHtml(data.storeAddress)}</div>
        <div>${escapeHtml(data.storePhone)}</div>
      </div>
      <div class="qr">${qrSvg(trackingUrl)}</div>
    </div>
  </div>
  <div class="footer">
    <span>Pathao Delivery · ${escapeHtml(data.orderNumber)}</span>
    <span>${trackingUrl}</span>
  </div>
</div>
<script>window.print();</script>
</body></html>`;

  return { html, filename: `pathao-${data.orderNumber}.html` };
}
