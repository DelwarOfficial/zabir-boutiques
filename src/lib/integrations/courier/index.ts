import type { CourierProvider, LabelData, LabelResult } from './types';
import { renderPathaoLabel } from './pathao';
import { renderSteadfastLabel } from './steadfast';
import { renderRedxLabel } from './redx';

const renderers: Record<CourierProvider, (data: LabelData, thermal: boolean) => LabelResult> = {
  pathao: renderPathaoLabel,
  steadfast: renderSteadfastLabel,
  redx: renderRedxLabel,
};

export function renderLabel(provider: CourierProvider, data: LabelData, thermal = false): LabelResult {
  return renderers[provider](data, thermal);
}

export function validateProvider(provider: string): CourierProvider | null {
  const p = provider.toLowerCase().trim();
  if (p === 'pathao' || p === 'steadfast' || p === 'redx') return p;
  return null;
}
