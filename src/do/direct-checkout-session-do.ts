import type { DirectCheckoutSessionDOContract } from '../lib/contracts/direct-checkout-session-do';

/**
 * DirectCheckoutSessionDO [Master_Prompt v7.0 §6.6, §10.6]
 *
 * Short-lived Buy Now session. Each session is a Durable Object keyed by
 * buy:{session_id}. The DO stores temporary order intent for the Buy Now
 * landing page flow.
 *
 * DirectCheckoutSessionDO does NOT mutate the normal cart. It creates a
 * separate checkout session that uses the same secure checkout engine.
 */

export interface DirectCheckoutSession {
  sessionId: string;
  productId: string;
  variantId: string;
  quantity: number;
  selectedOptions: Record<string, string>;
  createdAt: string;
  expiresAt: string;
  landingVersion: number;
  sourcePage: string | null;
  utmParams: Record<string, string> | null;
  origin: string;
  userAgentHash: string;
  formDraft: {
    name?: string;
    phone?: string;
    address?: string;
    shippingZone?: string;
  } | null;
}

export class DirectCheckoutSessionDO implements DurableObject, DirectCheckoutSessionDOContract {
  private state: DurableObjectState;
  private session: DirectCheckoutSession | null = null;

  constructor(state: DurableObjectState, _env: unknown) {
    this.state = state;
  }

  private async ensureLoaded(): Promise<DirectCheckoutSession | null> {
    if (this.session) return this.session;
    const stored = await this.state.storage.get<DirectCheckoutSession>('session');
    this.session = stored ?? null;
    return this.session;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.pathname.slice(1) || 'get';
    const body = (await request.json().catch(() => ({}))) as {
      productId?: string;
      variantId?: string;
      quantity?: number;
      selectedOptions?: Record<string, string>;
      sourcePage?: string;
      utmParams?: Record<string, string>;
      formDraft?: DirectCheckoutSession['formDraft'];
      sessionId?: string;
      origin?: string;
      userAgent?: string;
      orderId?: string;
    };

    switch (action) {
      case 'create': {
        if (!body.productId || !body.variantId || !body.quantity || body.quantity < 1) {
          return Response.json({ ok: false, error: 'INVALID_INPUT' }, { status: 400 });
        }

        const sessionId = body.sessionId || crypto.randomUUID();
        const now = new Date();
        const expiresAt = new Date(now.getTime() + 30 * 60 * 1000); // 30 minutes

        this.session = {
          sessionId,
          productId: body.productId,
          variantId: body.variantId,
          quantity: body.quantity,
          selectedOptions: body.selectedOptions ?? {},
          createdAt: now.toISOString(),
          expiresAt: expiresAt.toISOString(),
          landingVersion: 1,
          sourcePage: body.sourcePage ?? null,
          utmParams: body.utmParams ?? null,
          origin: body.origin ?? '',
          userAgentHash: await sha256(body.userAgent ?? ''),
          formDraft: null,
        };

        await this.state.storage.put('session', this.session);

        // Set alarm for cleanup [Master_Prompt v7.0 §6.8]
        await this.state.storage.setAlarm(expiresAt.getTime());

        return Response.json({ ok: true, session: this.session });
      }

      case 'get': {
        const session = await this.ensureLoaded();
        if (!session) {
          return Response.json({ ok: false, error: 'SESSION_NOT_FOUND' }, { status: 404 });
        }

        // Check expiry
        if (new Date(session.expiresAt) < new Date()) {
          return Response.json({ ok: false, error: 'SESSION_EXPIRED' }, { status: 410 });
        }

        const verification = await verifySessionBinding(session, body.origin, body.userAgent);
        if (verification) {
          await this.state.storage.deleteAll();
          this.session = null;
          return Response.json({ ok: false, error: verification }, { status: 403 });
        }

        return Response.json({ ok: true, session });
      }

      case 'draft': {
        const session = await this.ensureLoaded();
        if (!session) {
          return Response.json({ ok: false, error: 'SESSION_NOT_FOUND' }, { status: 404 });
        }

        const verification = await verifySessionBinding(session, body.origin, body.userAgent);
        if (verification) {
          await this.state.storage.deleteAll();
          this.session = null;
          return Response.json({ ok: false, error: verification }, { status: 403 });
        }

        session.formDraft = body.formDraft ?? null;
        session.landingVersion++;
        await this.state.storage.put('session', session);

        return Response.json({ ok: true, session });
      }

      case 'clear': {
        const session = await this.ensureLoaded();
        if (session) {
          const verification = await verifySessionBinding(session, body.origin, body.userAgent);
          if (verification) {
            await this.state.storage.deleteAll();
            this.session = null;
            return Response.json({ ok: false, error: verification }, { status: 403 });
          }
        }
        // Save orderId before cleanup so alarm can check it (Master Plan §6.8)
        if (body.orderId) {
          await this.state.storage.put('orderId', body.orderId);
        }
        // Delete session data but keep orderId for alarm guardrail
        await this.state.storage.delete('session');
        this.session = null;
        return Response.json({ ok: true });
      }

      default:
        return Response.json({ ok: false, error: 'UNKNOWN_ACTION' }, { status: 400 });
    }
  }

  /** Alarm-based cleanup [Master_Prompt v7.0 §6.8] */
  async alarm(): Promise<void> {
    const session = await this.ensureLoaded();
    const hasOrder = await this.state.storage.get('orderId');

    // If neither session nor orderId exist, clean up fully
    if (!session && !hasOrder) {
      await this.state.storage.deleteAll();
      return;
    }

    // If session exists but no order was created, clean up
    if (session && !hasOrder) {
      await this.state.storage.deleteAll();
    }
  }

  async create(input: { product_id: string; variant_id: string; quantity: number; selected_options: Record<string, string>; source_page: string; origin: string; user_agent: string }): Promise<{ session_id: string; expires_at: string }> {
    const res = await this.fetch(new Request('https://do/create', {
      method: 'POST',
      body: JSON.stringify({
        productId: input.product_id,
        variantId: input.variant_id,
        quantity: input.quantity,
        selectedOptions: input.selected_options,
        sourcePage: input.source_page,
        origin: input.origin,
        userAgent: input.user_agent,
      }),
    }));
    const data = await res.json() as { session?: DirectCheckoutSession };
    return { session_id: data.session?.sessionId ?? '', expires_at: data.session?.expiresAt ?? '' };
  }

  async get(input: { session_id: string; origin: string; user_agent: string }): Promise<unknown> {
    return this.fetch(new Request('https://do/get', { method: 'POST', body: JSON.stringify({ sessionId: input.session_id, origin: input.origin, userAgent: input.user_agent }) })).then((r) => r.json());
  }

  async updateFormDraft(input: { session_id: string; form_draft: Record<string, string>; origin: string; user_agent: string }): Promise<unknown> {
    return this.fetch(new Request('https://do/draft', { method: 'POST', body: JSON.stringify({ sessionId: input.session_id, formDraft: input.form_draft, origin: input.origin, userAgent: input.user_agent }) })).then((r) => r.json());
  }

  async markConvertedAndDelete(input: { session_id: string; order_id: string; origin: string; user_agent: string }): Promise<{ deleted: true } | { error: string }> {
    const res = await this.fetch(new Request('https://do/clear', { method: 'POST', body: JSON.stringify({ sessionId: input.session_id, orderId: input.order_id, origin: input.origin, userAgent: input.user_agent }) }));
    if (!res.ok) {
      const data = await res.json() as { error?: string };
      return { error: data.error ?? 'CLEAR_FAILED' };
    }
    return { deleted: true };
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

async function verifySessionBinding(
  session: DirectCheckoutSession,
  origin: string | undefined,
  userAgent: string | undefined,
): Promise<'ORIGIN_MISMATCH' | 'USER_AGENT_MISMATCH' | null> {
  if (session.origin && origin !== session.origin) return 'ORIGIN_MISMATCH';
  const userAgentHash = await sha256(userAgent ?? '');
  if (session.userAgentHash && userAgentHash !== session.userAgentHash) return 'USER_AGENT_MISMATCH';
  return null;
}
