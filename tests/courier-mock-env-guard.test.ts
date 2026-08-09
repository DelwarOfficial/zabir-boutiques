import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('K-34: courier mock mode cannot be triggered by request body alone in production', () => {
  const src = readFileSync(resolve('./src/pages/api/staff/orders/[id]/courier.ts'), 'utf8');

  it('no longer passes body.mock straight through to createCourierClient', () => {
    expect(src).not.toContain("createCourierClient(provider, env as CourierEnv, { mock: body.mock === true })");
  });

  it('mock is gated on isLocalHttpDev(context.request) in addition to body.mock', () => {
    expect(src).toContain('const allowMock = body.mock === true && isLocalHttpDev(context.request);');
    expect(src).toContain('createCourierClient(provider, env as CourierEnv, { mock: allowMock })');
  });
});
