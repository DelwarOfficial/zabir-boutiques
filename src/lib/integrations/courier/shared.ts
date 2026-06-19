import type { LabelData } from './types';

export function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function paymentLabel(data: LabelData): string {
  if (data.paymentMethod === 'in_store') return 'PAID (In-Store)';
  if (data.paymentMethod === 'uddoktapay' && data.paymentStatus === 'paid') return 'PAID (Online)';
  if (data.advancePaisa > 0 && data.balancePaisa > 0) return `PARTIAL ৳${Math.floor(data.advancePaisa / 100)}P / ৳${Math.floor(data.balancePaisa / 100)}COD`;
  if (data.paymentMethod === 'uddoktapay') return 'PENDING';
  return 'COD';
}

export function qrSvg(url: string, size = 48): string {
  const hex = url.split('').reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
  const seed = Math.abs(hex);
  const cells: boolean[] = [];
  for (let i = 0; i < 16 * 16; i++) cells.push(((seed * (i + 1)) % 3) !== 0);

  const cellSize = size / 20;
  const offset = cellSize * 2;
  const rects = cells.map((on, i) => {
    if (!on) return '';
    const x = (i % 16) * cellSize + offset;
    const y = Math.floor(i / 16) * cellSize + offset;
    return `<rect x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" fill="#000"/>`;
  }).join('');

  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${size}" height="${size}" fill="#fff"/>
    <rect x="${cellSize}" y="${cellSize}" width="${cellSize * 6}" height="${cellSize * 6}" fill="#000"/>
    <rect x="${size - cellSize * 7}" y="${cellSize}" width="${cellSize * 6}" height="${cellSize * 6}" fill="#000"/>
    <rect x="${cellSize}" y="${size - cellSize * 7}" width="${cellSize * 6}" height="${cellSize * 6}" fill="#000"/>
    ${rects}
  </svg>`;
}
