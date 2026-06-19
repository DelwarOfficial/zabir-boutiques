import type { LabelData, LabelResult } from './types';
import { escapeHtml, qrSvg, paymentLabel } from './shared';

export function renderSteadfastLabel(data: LabelData, thermal: boolean): LabelResult {
  const w = thermal ? '101.6mm' : '210mm';
  const h = thermal ? '152.4mm' : '99mm';
  const totalTaka = `৳${Math.floor(data.totalPaisa / 100)}`;
  const trackingUrl = `https://steadfast.com.bd/track/${data.orderNumber}`;

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>Steadfast - ${escapeHtml(data.orderNumber)}</title>
<style>
  @page { size: ${w} ${h}; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Courier New', monospace; }
  .label { width: ${w}; height: ${h}; padding: 5mm; display: flex; flex-direction: column; border: 2px solid #F37021; }
  .header { display: flex; justify-content: space-between; align-items: center; background: #F37021; color: #fff; padding: 2mm 4mm; margin: -5mm -5mm 3mm -5mm; }
  .brand { font-weight: 900; font-size: 14pt; letter-spacing: 1mm; }
  .order-num { font-size: 11pt; font-weight: 700; background: #fff; color: #F37021; padding: 1mm 3mm; }
  .grid { display: grid; grid-template-columns: 2fr 1fr; gap: 4mm; flex: 1; padding: 2mm 0; }
  .section-label { font-size: 7pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5mm; border-bottom: 1px dashed #ccc; margin-bottom: 1mm; }
  .recipient .name { font-weight: 900; font-size: 15pt; margin: 1mm 0; }
  .recipient .phone { font-size: 14pt; font-weight: 700; }
  .recipient .address { font-size: 10pt; line-height: 1.4; color: #333; margin-top: 1mm; }
  .sender { font-size: 9pt; color: #555; }
  .payment { font-size: 10pt; margin-top: 2mm; padding: 1mm 2mm; border: 1px solid #333; display: inline-block; font-weight: 700; }
  .qr { text-align: right; }
  .qr svg { width: ${thermal ? '60' : '50'}px; height: ${thermal ? '60' : '50'}px; }
  .footer { border-top: 1px solid #F37021; padding-top: 2mm; font-size: 8pt; color: #F37021; display: flex; justify-content: space-between; margin-top: auto; }
  @media print { body { margin: 0; } .label { border: none; } }
</style></head><body>
<div class="label">
  <div class="header">
    <span class="brand">STEADFAST</span>
    <span class="order-num">${escapeHtml(data.orderNumber)}</span>
  </div>
  <div class="grid">
    <div class="recipient">
      <div class="section-label">Recipient</div>
      <div class="name">${escapeHtml(data.customerName)}</div>
      <div class="phone">${escapeHtml(data.customerPhone)}</div>
      <div class="address">${escapeHtml(data.customerAddress)}</div>
      <div class="payment">${escapeHtml(totalTaka)} — ${escapeHtml(paymentLabel(data))}</div>
    </div>
    <div style="display:flex;flex-direction:column;justify-content:space-between">
      <div class="sender">
        <div class="section-label">Sender</div>
        <div style="font-weight:700">${escapeHtml(data.storeName)}</div>
        <div>${escapeHtml(data.storeAddress)}</div>
        <div>${escapeHtml(data.storePhone)}</div>
      </div>
      <div class="qr">${qrSvg(trackingUrl)}</div>
    </div>
  </div>
  <div class="footer">
    <span>www.steadfast.com.bd</span>
    <span>${escapeHtml(data.orderNumber)}</span>
  </div>
</div>
<script>window.print();</script>
</body></html>`;

  return { html, filename: `steadfast-${data.orderNumber}.html` };
}
