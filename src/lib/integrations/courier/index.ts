import type { CourierProvider, CourierProviderInterface, CourierEnv, LabelData, LabelResult } from './types';
import { PathaoClient, MockPathaoClient } from './pathao/index';
import { SteadfastClient, MockSteadfastClient } from './steadfast/index';
import { RedxClient, MockRedxClient } from './redx/index';
import { renderPathaoLabel } from './pathao.ts';
import { renderSteadfastLabel } from './steadfast.ts';
import { renderRedxLabel } from './redx.ts';

const renderers: Record<CourierProvider, (data: LabelData, thermal: boolean) => LabelResult> = {
  pathao: renderPathaoLabel,
  steadfast: renderSteadfastLabel,
  redx: renderRedxLabel,
};

export function createCourierClient(
  provider: CourierProvider,
  env: CourierEnv,
  options?: { mock?: boolean },
): CourierProviderInterface {
  if (options?.mock) {
    switch (provider) {
      case 'pathao': return new MockPathaoClient();
      case 'steadfast': return new MockSteadfastClient();
      case 'redx': return new MockRedxClient();
    }
  }
  switch (provider) {
    case 'pathao': return new PathaoClient(env);
    case 'steadfast': return new SteadfastClient(env);
    case 'redx': return new RedxClient(env);
  }
}

export function renderLabel(provider: CourierProvider, data: LabelData, thermal = false): LabelResult {
  return renderers[provider](data, thermal);
}

export function validateProvider(provider: string): CourierProvider | null {
  const p = provider.toLowerCase().trim();
  if (p === 'pathao' || p === 'steadfast' || p === 'redx') return p;
  return null;
}

export type { CourierProvider, CourierEnv, LabelData, LabelResult, CreateShipmentInput, CreateShipmentResult } from './types';
export { CourierError } from './errors';