import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SendEmailRequest, SendResponse } from '../src/lib/contracts/email-provider';

const {
  resendSendEmailMock,
  safeLogWarnMock,
  safeLogErrorMock,
} = vi.hoisted(() => ({
  resendSendEmailMock: vi.fn<(_: SendEmailRequest) => Promise<SendResponse>>(),
  safeLogWarnMock: vi.fn(),
  safeLogErrorMock: vi.fn(),
}));

vi.mock('../src/lib/integrations/email/resend', () => ({
  ResendEmailProvider: class {
    sendEmail(request: SendEmailRequest): Promise<SendResponse> {
      return resendSendEmailMock(request);
    }
  },
}));

vi.mock('../src/lib/pii-scrubber', () => ({
  safeLog: {
    warn: safeLogWarnMock,
    error: safeLogErrorMock,
  },
}));

import { CloudflareEmailProvider } from '../src/lib/integrations/email/cloudflare_email';

const baseRequest: SendEmailRequest = {
  to: ['customer@example.com'],
  from_name: 'Zabir Boutiques',
  subject: 'Order confirmed',
  html: '<p>Hello</p>',
  message_id: 'msg-123',
  custom_args: { email_type: 'order_confirmed' },
};

describe('CloudflareEmailProvider MailChannels fallback behavior', () => {
  beforeEach(() => {
    resendSendEmailMock.mockReset();
    safeLogWarnMock.mockReset();
    safeLogErrorMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends successfully through MailChannels', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
    } as Response);
    global.fetch = fetchMock as typeof fetch;

    const provider = new CloudflareEmailProvider({});
    const result = await provider.sendEmail(baseRequest);

    expect(result).toEqual({
      accepted: true,
      provider: 'cloudflare_email',
      status: 'sent',
      provider_message_id: 'msg-123',
    });
    expect(resendSendEmailMock).not.toHaveBeenCalled();
    expect(safeLogWarnMock).not.toHaveBeenCalled();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.mailchannels.net/tx/v1/send');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'Content-Type': 'application/json' });
    expect(JSON.parse(String(init.body))).toEqual({
      personalizations: [
        {
          to: [{ email: 'customer@example.com' }],
        },
      ],
      from: {
        // Falls back to the shared default when RESEND_FROM_EMAIL is unset.
        email: 'orders@zabirboutiques.com',
        name: 'Zabir Boutiques',
      },
      subject: 'Order confirmed',
      content: [
        {
          type: 'text/html',
          value: '<p>Hello</p>',
        },
      ],
    });
  });

  it('uses RESEND_FROM_EMAIL as the MailChannels sender so both providers send from one address', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 } as Response);
    global.fetch = fetchMock as typeof fetch;

    const provider = new CloudflareEmailProvider({ RESEND_FROM_EMAIL: 'support@zabirboutiques.com' });
    await provider.sendEmail(baseRequest);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).from).toEqual({
      email: 'support@zabirboutiques.com',
      name: 'Zabir Boutiques',
    });
  });

  it('strips a display name from RESEND_FROM_EMAIL — MailChannels rejects "Name <addr>" in from.email', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 } as Response);
    global.fetch = fetchMock as typeof fetch;

    const provider = new CloudflareEmailProvider({ RESEND_FROM_EMAIL: 'Zabir Boutiques <orders@zabirboutiques.com>' });
    await provider.sendEmail(baseRequest);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).from.email).toBe('orders@zabirboutiques.com');
  });

  it('ignores a blank RESEND_FROM_EMAIL rather than sending an empty From', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 } as Response);
    global.fetch = fetchMock as typeof fetch;

    const provider = new CloudflareEmailProvider({ RESEND_FROM_EMAIL: '   ' });
    await provider.sendEmail(baseRequest);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).from.email).toBe('orders@zabirboutiques.com');
  });

  it('falls back to Resend when MailChannels returns a non-2xx response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('mailchannels outage'),
    } as Response) as typeof fetch;
    resendSendEmailMock.mockResolvedValue({
      accepted: true,
      provider: 'resend',
      status: 'sent',
      provider_message_id: 're_123',
    });

    const provider = new CloudflareEmailProvider({ RESEND_API_KEY: 'resend-key' });
    const result = await provider.sendEmail(baseRequest);

    expect(result).toEqual({
      accepted: true,
      provider: 'resend',
      status: 'sent',
      provider_message_id: 're_123',
    });
    expect(resendSendEmailMock).toHaveBeenCalledWith(baseRequest);
    expect(safeLogWarnMock).toHaveBeenCalledWith('[Email] MailChannels failed. Falling back to Resend.', expect.objectContaining({
      errorCode: 'HTTP_500',
      errorMessage: 'mailchannels outage',
      emailType: 'order_confirmed',
      messageId: 'msg-123',
    }));
    expect(safeLogErrorMock).not.toHaveBeenCalled();
  });

  it('returns a clear failure when MailChannels and Resend both fail', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network down')) as typeof fetch;
    resendSendEmailMock.mockResolvedValue({
      accepted: false,
      provider: 'resend',
      status: 'failed',
      error_code: 'HTTP_503',
    });

    const provider = new CloudflareEmailProvider({ RESEND_API_KEY: 'resend-key' });
    const result = await provider.sendEmail(baseRequest);

    expect(result).toEqual({
      accepted: false,
      provider: 'resend',
      status: 'failed',
      error_code: 'HTTP_503',
      error_message: 'MailChannels failed and Resend fallback failed',
    });
    expect(safeLogWarnMock).toHaveBeenCalledWith('[Email] MailChannels failed. Falling back to Resend.', expect.objectContaining({
      errorCode: 'MAILCHANNELS_FETCH_FAILED',
      errorMessage: 'network down',
    }));
    expect(safeLogErrorMock).toHaveBeenCalledWith('[Email] MailChannels and Resend both failed.', expect.objectContaining({
      primaryErrorCode: 'MAILCHANNELS_FETCH_FAILED',
      fallbackErrorCode: 'HTTP_503',
      emailType: 'order_confirmed',
    }));
  });

  // N-24: the winning provider must be recoverable from the SendResponse,
  // because email_log persists it. Before this, a delivered message recorded
  // only 'sent' — indistinguishable between primary and fallback, which is
  // what made "did MailChannels actually send?" unanswerable from data.
  it('N-24: reports cloudflare_email as the provider when MailChannels succeeds', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 202 } as Response) as typeof fetch;

    const result = await new CloudflareEmailProvider({}).sendEmail(baseRequest);

    expect(result.accepted).toBe(true);
    expect(result.provider).toBe('cloudflare_email');
    expect(resendSendEmailMock).not.toHaveBeenCalled();
  });

  it('N-24: reports resend as the provider when the fallback delivers', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Authorization Required',
    } as unknown as Response) as typeof fetch;
    resendSendEmailMock.mockResolvedValue({
      accepted: true,
      provider: 'resend',
      status: 'sent',
      provider_message_id: 'resend-1',
    });

    const result = await new CloudflareEmailProvider({}).sendEmail(baseRequest);

    expect(result.accepted).toBe(true);
    expect(result.provider).toBe('resend');
    expect(resendSendEmailMock).toHaveBeenCalledTimes(1);
  });

  it('N-24: MailChannels success sends exactly once and never duplicates via the fallback', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 } as Response);
    global.fetch = fetchMock as typeof fetch;

    await new CloudflareEmailProvider({}).sendEmail(baseRequest);

    // One outbound MailChannels call, zero Resend calls: no double delivery.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(resendSendEmailMock).not.toHaveBeenCalled();
    expect(safeLogWarnMock).not.toHaveBeenCalled();
  });

  it('N-24: surfaces the real MailChannels 401 so a dead relay cannot fail silently', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Authorization Required',
    } as unknown as Response) as typeof fetch;
    resendSendEmailMock.mockResolvedValue({
      accepted: true,
      provider: 'resend',
      status: 'sent',
      provider_message_id: 'resend-2',
    });

    await new CloudflareEmailProvider({}).sendEmail(baseRequest);

    expect(safeLogWarnMock).toHaveBeenCalledWith(
      '[Email] MailChannels failed. Falling back to Resend.',
      expect.objectContaining({ errorCode: 'HTTP_401' }),
    );
  });
});
