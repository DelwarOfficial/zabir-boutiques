import type { CartDOContract } from '../lib/contracts/cart-do';

/**
 * CartDO [Master_Prompt v7.0 §6.6, §9]
 *
 * Active cart source of truth. Each cart is a Durable Object keyed by
 * cart:{session_id}. The DO serializes all cart mutations (add, remove,
 * quantity change, clear) across Worker isolates.
 *
 * CartDO does NOT synchronously write D1 on every mutation. Instead, it
 * publishes lightweight messages to the cart-activity queue for batched
 * D1 writes.
 */

export interface CartItem {
  variantId: string;
  quantity: number;
  addedAt: string;
  updatedAt: string;
}

export interface CartState {
  items: CartItem[];
  lastUpdatedAt: string;
  cartVersion: number;
  couponCode: string | null;
  customerContact: string | null;
}

export class CartDO implements DurableObject, CartDOContract {
  private state: DurableObjectState;
  private env: { CART_ACTIVITY?: Queue; DB?: D1Database };
  private cart: CartState | null = null;

  constructor(state: DurableObjectState, env: { CART_ACTIVITY?: Queue; DB?: D1Database }) {
    this.state = state;
    this.env = env;
  }

  private async ensureLoaded(): Promise<CartState> {
    if (this.cart) return this.cart;
    const stored = await this.state.storage.get<CartState>('cart');
    this.cart = stored ?? {
      items: [],
      lastUpdatedAt: new Date().toISOString(),
      cartVersion: 0,
      couponCode: null,
      customerContact: null,
    };
    return this.cart;
  }

  private async persist(): Promise<void> {
    if (!this.cart) return;
    await this.state.storage.put('cart', this.cart);
  }

  private async persistMutation(cart: CartState): Promise<void> {
    await this.persist();
    await this.publishActivity(cart);
    await this.state.storage.setAlarm(Date.now() + 5 * 60 * 1000);
  }

  async getCart(_input: unknown): Promise<{ ok: true; cart: CartState; currentVersion: number }> {
    const cart = await this.ensureLoaded();
    return { ok: true, cart, currentVersion: cart.cartVersion };
  }

  async addItem(input: { variantId?: string; quantity?: number; clientVersion?: number }): Promise<unknown> {
    return this.fetch(new Request('https://do/add', { method: 'POST', body: JSON.stringify(input) })).then((r) => r.json());
  }

  async removeItem(input: { variantId?: string; clientVersion?: number }): Promise<unknown> {
    return this.fetch(new Request('https://do/remove', { method: 'POST', body: JSON.stringify(input) })).then((r) => r.json());
  }

  async changeQuantity(input: { variantId?: string; quantity?: number; clientVersion?: number }): Promise<unknown> {
    return this.fetch(new Request('https://do/quantity', { method: 'POST', body: JSON.stringify(input) })).then((r) => r.json());
  }

  async clearCart(input: { clientVersion?: number }): Promise<unknown> {
    return this.fetch(new Request('https://do/clear', { method: 'POST', body: JSON.stringify(input) })).then((r) => r.json());
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.pathname.slice(1) || 'get';
    const body = (await request.json().catch(() => ({}))) as {
      variantId?: string;
      quantity?: number;
      clientVersion?: number;
      couponCode?: string;
      customerContact?: string;
    };

    const cart = await this.ensureLoaded();

    // Version conflict check [Master_Prompt v7.0 §9.2]
    if (action !== 'get' && typeof body.clientVersion === 'number') {
      if (body.clientVersion < cart.cartVersion) {
        return Response.json(
          { ok: false, code: 'CART_VERSION_CONFLICT', cart, currentVersion: cart.cartVersion },
          { status: 409 },
        );
      }
    }

    const now = new Date().toISOString();

    switch (action) {
      case 'get':
        return Response.json({ ok: true, cart, currentVersion: cart.cartVersion });

      case 'add': {
        if (!body.variantId || !body.quantity || body.quantity < 1) {
          return Response.json({ ok: false, error: 'INVALID_INPUT' }, { status: 400 });
        }
        const existing = cart.items.find((i) => i.variantId === body.variantId);
        if (existing) {
          existing.quantity += body.quantity;
          existing.updatedAt = now;
        } else {
          cart.items.push({ variantId: body.variantId, quantity: body.quantity, addedAt: now, updatedAt: now });
        }
        cart.lastUpdatedAt = now;
        cart.cartVersion++;
        await this.persistMutation(cart);
        return Response.json({ ok: true, cart, currentVersion: cart.cartVersion });
      }

      case 'remove': {
        if (!body.variantId) {
          return Response.json({ ok: false, error: 'INVALID_INPUT' }, { status: 400 });
        }
        cart.items = cart.items.filter((i) => i.variantId !== body.variantId);
        cart.lastUpdatedAt = now;
        cart.cartVersion++;
        await this.persistMutation(cart);
        return Response.json({ ok: true, cart, currentVersion: cart.cartVersion });
      }

      case 'quantity': {
        if (!body.variantId || !body.quantity || body.quantity < 1) {
          return Response.json({ ok: false, error: 'INVALID_INPUT' }, { status: 400 });
        }
        const item = cart.items.find((i) => i.variantId === body.variantId);
        if (!item) {
          return Response.json({ ok: false, error: 'ITEM_NOT_FOUND' }, { status: 404 });
        }
        item.quantity = body.quantity;
        item.updatedAt = now;
        cart.lastUpdatedAt = now;
        cart.cartVersion++;
        await this.persistMutation(cart);
        return Response.json({ ok: true, cart, currentVersion: cart.cartVersion });
      }

      case 'clear': {
        cart.items = [];
        cart.couponCode = null;
        cart.lastUpdatedAt = now;
        cart.cartVersion++;
        await this.persistMutation(cart);
        return Response.json({ ok: true, cart, currentVersion: cart.cartVersion });
      }

      case 'coupon': {
        cart.couponCode = body.couponCode ?? null;
        cart.lastUpdatedAt = now;
        cart.cartVersion++;
        await this.persistMutation(cart);
        return Response.json({ ok: true, cart, currentVersion: cart.cartVersion });
      }

      case 'contact': {
        cart.customerContact = body.customerContact ?? null;
        cart.lastUpdatedAt = now;
        await this.persistMutation(cart);
        return Response.json({ ok: true, cart, currentVersion: cart.cartVersion });
      }

      default:
        return Response.json({ ok: false, error: 'UNKNOWN_ACTION' }, { status: 400 });
    }
  }

  /** Publish cart activity for batched D1 writes [Master_Prompt v7.0 §6.3] */
  private async publishActivity(cart: CartState): Promise<void> {
    const activity = {
      sessionId: this.state.id.toString(),
      itemCount: cart.items.length,
      totalQuantity: cart.items.reduce((sum, i) => sum + i.quantity, 0),
      subtotalPaisa: 0, // Price loaded from D1 at checkout time
      lastCartUpdateAt: cart.lastUpdatedAt,
      cartVersion: cart.cartVersion,
      customerContact: cart.customerContact,
    };
    if (this.env.CART_ACTIVITY) {
      try {
        await this.env.CART_ACTIVITY.send(activity);
      } catch {
        // Queue send failed — store for retry
        await this.state.storage.put('pendingActivity', activity);
      }
    } else {
      await this.state.storage.put('pendingActivity', activity);
    }
  }

  /** Alarm-based cleanup [Master_Prompt v7.0 §6.8] */
  async alarm(): Promise<void> {
    const cart = await this.ensureLoaded();
    const lastUpdate = new Date(cart.lastUpdatedAt).getTime();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

    await this.upsertCartActivity(cart);

    if (Date.now() - lastUpdate > thirtyDaysMs) {
      await this.publishActivity(cart);
      await this.state.storage.deleteAll();
      return;
    }
  }

  private async upsertCartActivity(cart: CartState): Promise<void> {
    if (!this.env.DB) return;
    const now = new Date().toISOString();
    const contact = parseContact(cart.customerContact);
    await this.env.DB.prepare(
      `INSERT INTO cart_activity (
        session_id, customer_phone, customer_email, customer_name, item_count,
        total_quantity, subtotal_paisa, last_cart_update_at, consent_status, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, 'unknown', ?8)
      ON CONFLICT(session_id) DO UPDATE SET
        customer_phone = COALESCE(excluded.customer_phone, cart_activity.customer_phone),
        customer_email = COALESCE(excluded.customer_email, cart_activity.customer_email),
        customer_name = COALESCE(excluded.customer_name, cart_activity.customer_name),
        item_count = excluded.item_count,
        total_quantity = excluded.total_quantity,
        subtotal_paisa = excluded.subtotal_paisa,
        last_cart_update_at = excluded.last_cart_update_at,
        updated_at = excluded.updated_at`,
    ).bind(
      this.state.id.toString(),
      contact.phone,
      contact.email,
      contact.name,
      cart.items.length,
      cart.items.reduce((sum, i) => sum + i.quantity, 0),
      cart.lastUpdatedAt,
      now,
    ).run();
  }
}

function parseContact(value: string | null): { phone: string | null; email: string | null; name: string | null } {
  if (!value) return { phone: null, email: null, name: null };
  try {
    const parsed = JSON.parse(value) as { phone?: string; email?: string; name?: string };
    return {
      phone: typeof parsed.phone === 'string' ? parsed.phone : null,
      email: typeof parsed.email === 'string' ? parsed.email : null,
      name: typeof parsed.name === 'string' ? parsed.name : null,
    };
  } catch {
    return { phone: value, email: null, name: null };
  }
}
