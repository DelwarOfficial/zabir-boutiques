import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const loginPage = readFileSync(resolve('./src/pages/staff/login.astro'), 'utf8');
const forgotPasswordPage = readFileSync(resolve('./src/pages/staff/forgot-password.astro'), 'utf8');
const forgotPasswordRoute = readFileSync(resolve('./src/pages/api/staff/forgot-password.ts'), 'utf8');

describe('staff auth Turnstile page integration', () => {
  it('renders staff auth widgets explicitly instead of relying on implicit cf-turnstile DOM scanning', () => {
    expect(loginPage).toContain('turnstile/v0/api.js?render=explicit');
    expect(forgotPasswordPage).toContain('turnstile/v0/api.js?render=explicit');
    expect(loginPage).toContain("window.turnstile.render(turnstileContainer");
    expect(forgotPasswordPage).toContain("window.turnstile.render(turnstileContainer");
    expect(loginPage).not.toContain('class="cf-turnstile');
    expect(forgotPasswordPage).not.toContain('class="cf-turnstile');
  });

  it('tracks the solved token in script state instead of scraping the hidden response input', () => {
    expect(loginPage).toContain("let turnstileToken = ''");
    expect(forgotPasswordPage).toContain("let turnstileToken = ''");
    expect(loginPage).not.toContain('cf-turnstile-response');
    expect(forgotPasswordPage).not.toContain('cf-turnstile-response');
  });

  it('clears consumed or stale tokens via explicit reset hooks', () => {
    expect(loginPage).toContain('resetTurnstile();');
    expect(loginPage).toContain('step2Token = \'\';');
    expect(forgotPasswordPage).toContain('resetTurnstile();');
    expect(forgotPasswordPage).toContain("msg.textContent = 'If an account exists, a reset link has been sent.';");
  });

  it('forgot-password route still relies on verifyTurnstile server-side without page-specific bypasses', () => {
    expect(forgotPasswordRoute).toContain('verifyTurnstile(env, token');
    expect(forgotPasswordRoute).toContain("return Response.json({ error: 'Bot check failed.' }, { status: 403 })");
  });
});
