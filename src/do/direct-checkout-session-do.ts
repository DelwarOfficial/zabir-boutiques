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
  formDraft: {
    name?: string;
    phone?: string;
    address?: string;
    shippingZone?: string;
  } | null;
}

export class DirectCheckoutSessionDO implements DurableObject {
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
    };

    switch (action) {
      case 'create': {
        if (!body.productId || !body.variantId || !body.quantity || body.quantity < 1) {
          return Response.json({ ok: false, error: 'INVALID_INPUT' }, { status: 400 });
        }

        const sessionId = crypto.randomUUID();
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

        return Response.json({ ok: true, session });
      }

      case 'draft': {
        const session = await this.ensureLoaded();
        if (!session) {
          return Response.json({ ok: false, error: 'SESSION_NOT_FOUND' }, { status: 404 });
        }

        session.formDraft = body.formDraft ?? null;
        session.landingVersion++;
        await this.state.storage.put('session', session);

        return Response.json({ ok: true, session });
      }

      case 'clear': {
        await this.state.storage.deleteAll();
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
    if (!session) {
      await this.state.storage.deleteAll();
      return;
    }

    // If no order exists, clean up
    const hasOrder = await this.state.storage.get('orderId');
    if (!hasOrder) {
      await this.state.storage.deleteAll();
    }
  }
}
