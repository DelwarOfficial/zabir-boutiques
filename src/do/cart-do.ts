import type { CartDOContract } from '../lib/contracts/cart-do';

export interface CartItem {
  variantId: string;
  quantity: number;
  addedAt: string;
  updatedAt: string;
}

export interface CartCustomerContact {
  name?: string;
  phone?: string;
  email?: string;
  consent_status: 'unknown' | 'allowed' | 'denied';
}

export interface CartDOState {
  session_id: string;
  items: CartItem[];
  coupon_code?: string;
  customer_contact?: CartCustomerContact;
  cart_version: number;
  last_mutation_at: string;
  last_persisted_at?: string;
  last_d1_write_seq: number;
}

/**
 * V8 Section 6.8 — a Durable Object has exactly one alarm. CartDO stores
 * `alarm_purpose` in DO storage and branches on it in `alarm()`:
 *   - 'persist': upsert cart_activity, then armAlarm('cleanup'). NEVER re-arm 'persist'.
 *   - 'cleanup': final cart_activity write, then deleteAll().
 * DO storage is already durable across restart/eviction; the alarm keeps the
 * D1 projection fresh, it is NOT a durability mechanism (RT-006, C-02).
 */
export type AlarmPurpose = 'persist' | 'cleanup';

const FIVE_MIN_MS = 5 * 60 * 1000;
const THIRTY_DAY_MS = 30 * 24 * 60 * 60 * 1000;

export class CartDO implements DurableObject, CartDOContract {
  private state: DurableObjectState;
  private env: { CART_ACTIVITY?: Queue; DB?: D1Database };
  private cart: CartDOState | null = null;
  /** N-2 Case A: true once this object has real state — either through a
   *  normal mutation or a migrate-in hydrate. Distinct from `cart !== null`
   *  because ensureLoaded() always returns a (possibly empty) cart. */
  private migrated = false;

  constructor(state: DurableObjectState, env: { CART_ACTIVITY?: Queue; DB?: D1Database }) {
    this.state = state;
    this.env = env;
  }

  private async ensureLoaded(): Promise<CartDOState> {
    if (this.cart) return this.cart;
    const [stored, migratedFlag] = await Promise.all([
      this.state.storage.get<CartDOState>('cart'),
      this.state.storage.get<boolean>('migrated'),
    ]);
    this.migrated = stored != null || migratedFlag === true;
    if (stored) {
      this.cart = stored;
      return this.cart;
    }
    const sessionId = this.state.id.toString();
    this.cart = {
      session_id: sessionId,
      items: [],
      cart_version: 0,
      last_mutation_at: new Date().toISOString(),
      last_d1_write_seq: 0,
    };
    return this.cart;
  }

  private async persist(): Promise<void> {
    if (!this.cart) return;
    await this.state.storage.put('cart', this.cart);
  }

  private async persistMutation(cart: CartDOState, _isNewCart: boolean): Promise<void> {
    await this.persist();
    await this.publishActivity(cart);
    // V8 §6.8: every mutation arms 'persist' (now + 5 min), superseding any
    // pending 'cleanup'. The persist fire hands off to 'cleanup'; it MUST NOT
    // re-arm itself.
    await this.armAlarm('persist');
  }

  /**
   * V8 §6.8 canonical single-alarm armer. Stores `alarm_purpose` in DO storage
   * and sets the one alarm slot. Called by every mutation with 'persist' and
   * by the persist fire with 'cleanup'.
   */
  async armAlarm(purpose: AlarmPurpose): Promise<void> {
    const delayMs = purpose === 'persist' ? FIVE_MIN_MS : THIRTY_DAY_MS;
    await this.state.storage.put('alarm_purpose', purpose);
    await this.state.storage.setAlarm(Date.now() + delayMs);
  }

  /**
   * Safety net: if a cart with items has somehow lost its alarm (e.g. after
   * DO eviction with no subsequent mutation), re-arm 'persist' once on read so
   * the D1 projection does not go stale. This is not a re-arm loop — the persist
   * fire hands off to 'cleanup' and does not re-arm 'persist' (RT-006).
   */
  private async reArmIfNeeded(): Promise<void> {
    const cart = await this.ensureLoaded();
    if (cart.items.length === 0) return;
    const existingAlarm = await this.state.storage.getAlarm();
    if (existingAlarm === null) {
      await this.armAlarm('persist');
      await this.persist();
    }
  }

  async getCart(_input: unknown): Promise<{ ok: true; cart: CartDOState; currentVersion: number }> {
    const cart = await this.ensureLoaded();
    await this.reArmIfNeeded();
    return { ok: true, cart, currentVersion: cart.cart_version };
  }

  async addItem(input: { variantId: string; quantity: number; clientVersion?: number }): Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number; error?: string; code?: string }> {
    return this.fetch(new Request('https://do/add', { method: 'POST', body: JSON.stringify(input) })).then((r) => r.json()) as Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number; error?: string; code?: string }>;
  }

  async removeItem(input: { variantId: string; clientVersion?: number }): Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number; error?: string }> {
    return this.fetch(new Request('https://do/remove', { method: 'POST', body: JSON.stringify(input) })).then((r) => r.json()) as Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number; error?: string }>;
  }

  async changeQuantity(input: { variantId: string; quantity: number; clientVersion?: number }): Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number; error?: string; code?: string }> {
    return this.fetch(new Request('https://do/quantity', { method: 'POST', body: JSON.stringify(input) })).then((r) => r.json()) as Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number; error?: string; code?: string }>;
  }

  async clearCart(input: { clientVersion?: number }): Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number }> {
    return this.fetch(new Request('https://do/clear', { method: 'POST', body: JSON.stringify(input) })).then((r) => r.json()) as Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number }>;
  }

  async applyCoupon(input: { couponCode: string; clientVersion?: number }): Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number }> {
    return this.fetch(new Request('https://do/coupon', { method: 'POST', body: JSON.stringify(input) })).then((r) => r.json()) as Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number }>;
  }

  async removeCoupon(input: { clientVersion?: number }): Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number }> {
    return this.fetch(new Request('https://do/coupon', { method: 'POST', body: JSON.stringify({ couponCode: null, clientVersion: input?.clientVersion }) })).then((r) => r.json()) as Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number }>;
  }

  async updateCustomerContact(input: { customerContact: CartCustomerContact; clientVersion?: number }): Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number }> {
    return this.fetch(new Request('https://do/contact', { method: 'POST', body: JSON.stringify(input) })).then((r) => r.json()) as Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number }>;
  }

  async mergeCart(input: { items: CartItem[]; clientVersion?: number }): Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number }> {
    return this.fetch(new Request('https://do/merge', { method: 'POST', body: JSON.stringify(input) })).then((r) => r.json()) as Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number }>;
  }

  async replaceAll(input: { items: CartItem[]; clientVersion?: number }): Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number }> {
    return this.fetch(new Request('https://do/replaceAll', { method: 'POST', body: JSON.stringify(input) })).then((r) => r.json()) as Promise<{ ok: boolean; cart?: CartDOState; currentVersion?: number }>;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const action = url.pathname.slice(1) || 'get';
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    const cart = await this.ensureLoaded();
    const wasEmpty = cart.items.length === 0;
    const now = new Date().toISOString();

    // N-2 Case A migration support — checked before the version-conflict
    // guard below since these two actions don't carry a clientVersion.
    if (action === 'init-status') {
      return Response.json({ initialized: this.migrated });
    }
    if (action === 'hydrate') {
      // Idempotent + race-free: CartDO serializes all fetch() calls to one
      // object, so a second concurrent hydrate attempt sees migrated=true
      // and no-ops instead of overwriting real data with a second copy of
      // the same snapshot.
      if (this.migrated) {
        return Response.json({ ok: true, alreadyMigrated: true });
      }
      const snapshot = body.cart as CartDOState | undefined;
      if (snapshot) {
        this.cart = { ...snapshot, session_id: this.state.id.toString() };
        this.migrated = true;
        await this.persist();
        if (this.cart.items.length > 0) await this.armAlarm('persist');
      } else {
        // Old DO had no state either — nothing to migrate, but still mark
        // this object as resolved (persisted, so it survives eviction) so
        // future requests skip the probe.
        this.migrated = true;
        await this.state.storage.put('migrated', true);
      }
      return Response.json({ ok: true, cart: this.cart });
    }

    if (action !== 'get' && typeof body.clientVersion === 'number') {
      if ((body.clientVersion as number) < cart.cart_version) {
        return Response.json(
          { ok: false, code: 'CART_VERSION_CONFLICT', cart, currentVersion: cart.cart_version },
          { status: 409 },
        );
      }
    }

    switch (action) {
      case 'get':
        await this.reArmIfNeeded();
        return Response.json({ ok: true, cart, currentVersion: cart.cart_version });

      case 'add': {
        const variantId = body.variantId as string | undefined;
        const quantity = body.quantity as number | undefined;
        if (!variantId || !quantity || quantity < 1) {
          return Response.json({ ok: false, error: 'INVALID_INPUT' }, { status: 400 });
        }
        const existing = cart.items.find((i) => i.variantId === variantId);
        if (existing) {
          existing.quantity += quantity;
          existing.updatedAt = now;
        } else {
          cart.items.push({ variantId, quantity, addedAt: now, updatedAt: now });
        }
        cart.last_mutation_at = now;
        cart.cart_version++;
        await this.persistMutation(cart, wasEmpty);
        return Response.json({ ok: true, cart, currentVersion: cart.cart_version });
      }

      case 'remove': {
        const variantId = body.variantId as string | undefined;
        if (!variantId) {
          return Response.json({ ok: false, error: 'INVALID_INPUT' }, { status: 400 });
        }
        const hadItem = cart.items.some((i) => i.variantId === variantId);
        if (!hadItem) {
          return Response.json({ ok: true, cart, currentVersion: cart.cart_version });
        }
        cart.items = cart.items.filter((i) => i.variantId !== variantId);
        cart.last_mutation_at = now;
        cart.cart_version++;
        await this.persistMutation(cart, false);
        return Response.json({ ok: true, cart, currentVersion: cart.cart_version });
      }

      case 'quantity': {
        const variantId = body.variantId as string | undefined;
        const quantity = body.quantity as number | undefined;
        if (!variantId || !quantity || quantity < 1) {
          return Response.json({ ok: false, error: 'INVALID_INPUT' }, { status: 400 });
        }
        const item = cart.items.find((i) => i.variantId === variantId);
        if (!item) {
          return Response.json({ ok: false, error: 'ITEM_NOT_FOUND' }, { status: 404 });
        }
        if (item.quantity === quantity) {
          return Response.json({ ok: true, cart, currentVersion: cart.cart_version });
        }
        item.quantity = quantity;
        item.updatedAt = now;
        cart.last_mutation_at = now;
        cart.cart_version++;
        await this.persistMutation(cart, false);
        return Response.json({ ok: true, cart, currentVersion: cart.cart_version });
      }

      case 'clear': {
        const hadContent = cart.items.length > 0 || !!cart.coupon_code || !!cart.customer_contact;
        if (!hadContent) {
          return Response.json({ ok: true, cart, currentVersion: cart.cart_version });
        }
        cart.items = [];
        cart.coupon_code = undefined;
        cart.last_mutation_at = now;
        cart.cart_version++;
        await this.persistMutation(cart, false);
        return Response.json({ ok: true, cart, currentVersion: cart.cart_version });
      }

      case 'coupon': {
        const newCode = body.couponCode as string | undefined || undefined;
        if (cart.coupon_code === newCode) {
          return Response.json({ ok: true, cart, currentVersion: cart.cart_version });
        }
        cart.coupon_code = newCode;
        cart.last_mutation_at = now;
        cart.cart_version++;
        await this.persistMutation(cart, false);
        return Response.json({ ok: true, cart, currentVersion: cart.cart_version });
      }

      case 'contact': {
        const customerContact = body.customerContact as CartCustomerContact | undefined;
        if (JSON.stringify(cart.customer_contact) === JSON.stringify(customerContact)) {
          return Response.json({ ok: true, cart, currentVersion: cart.cart_version });
        }
        cart.customer_contact = customerContact;
        cart.last_mutation_at = now;
        cart.cart_version++;
        await this.persistMutation(cart, false);
        return Response.json({ ok: true, cart, currentVersion: cart.cart_version });
      }

      case 'merge': {
        const mergeItems = body.items as CartItem[] | undefined;
        if (!mergeItems || mergeItems.length === 0) {
          return Response.json({ ok: true, cart, currentVersion: cart.cart_version });
        }
        for (const mergeItem of mergeItems) {
          const existing = cart.items.find((i) => i.variantId === mergeItem.variantId);
          if (existing) {
            existing.quantity = Math.max(existing.quantity, mergeItem.quantity);
            existing.updatedAt = now;
          } else {
            cart.items.push({ ...mergeItem, updatedAt: now });
          }
        }
        cart.last_mutation_at = now;
        cart.cart_version++;
        await this.persistMutation(cart, wasEmpty);
        return Response.json({ ok: true, cart, currentVersion: cart.cart_version });
      }

      case 'replaceAll': {
        const replaceItems = body.items as CartItem[] | undefined;
        cart.items = (replaceItems ?? []).map((item) => ({
          variantId: item.variantId,
          quantity: Math.max(1, item.quantity),
          addedAt: now,
          updatedAt: now,
        }));
        cart.last_mutation_at = now;
        cart.cart_version++;
        await this.persistMutation(cart, wasEmpty);
        return Response.json({ ok: true, cart, currentVersion: cart.cart_version });
      }

      default:
        return Response.json({ ok: false, error: 'UNKNOWN_ACTION' }, { status: 400 });
    }
  }

  private async publishActivity(cart: CartDOState): Promise<void> {
    const activity = {
      sessionId: this.state.id.toString(),
      itemCount: cart.items.length,
      totalQuantity: cart.items.reduce((sum, i) => sum + i.quantity, 0),
      subtotalPaisa: 0,
      lastCartUpdateAt: cart.last_mutation_at,
      cartVersion: cart.cart_version,
    };
    if (this.env.CART_ACTIVITY) {
      try {
        await this.env.CART_ACTIVITY.send(activity);
      } catch {
        await this.state.storage.put('pendingActivity', activity);
      }
    } else {
      await this.state.storage.put('pendingActivity', activity);
    }
  }

  async alarm(): Promise<void> {
    const cart = await this.ensureLoaded();
    const purpose = await this.state.storage.get<AlarmPurpose>('alarm_purpose');

    // Empty cart: nothing to project, clean up immediately.
    if (cart.items.length === 0) {
      await this.state.storage.deleteAll();
      return;
    }

    if (purpose === 'cleanup') {
      // Final projection write + queue flush, then delete the DO.
      await this.upsertCartActivity(cart, 'lifecycle_cleanup');
      await this.publishActivity(cart);
      await this.state.storage.deleteAll();
      return;
    }

    // 'persist' (or unset legacy state): upsert cart_activity, then hand off
    // to the long 'cleanup' timer. MUST NOT re-arm 'persist' — re-arming would
    // wake an abandoned cart ~8,640x/month and destroy the cost posture (RT-006).
    await this.upsertCartActivity(cart, 'alarm');
    await this.armAlarm('cleanup');
  }

  private async upsertCartActivity(cart: CartDOState, writeSource: 'alarm' | 'lifecycle_cleanup' | 'manual_repair'): Promise<void> {
    if (!this.env.DB) return;
    const now = new Date().toISOString();
    const nextSeq = cart.last_d1_write_seq + 1;
    const contact = cart.customer_contact;

    await this.env.DB.prepare(
      `INSERT INTO cart_activity (
        session_id, customer_phone, customer_email, customer_name, item_count,
        total_quantity, subtotal_paisa, last_cart_update_at, consent_status,
        last_d1_write_at, last_d1_write_source, last_d1_write_seq, updated_at
      ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, ?7, ?8, ?9, ?10, ?11, ?9)
      ON CONFLICT(session_id) DO UPDATE SET
        customer_phone = excluded.customer_phone,
        customer_email = excluded.customer_email,
        customer_name = excluded.customer_name,
        item_count = excluded.item_count,
        total_quantity = excluded.total_quantity,
        subtotal_paisa = excluded.subtotal_paisa,
        last_cart_update_at = excluded.last_cart_update_at,
        consent_status = excluded.consent_status,
        last_d1_write_at = excluded.last_d1_write_at,
        last_d1_write_source = excluded.last_d1_write_source,
        last_d1_write_seq = cart_activity.last_d1_write_seq + 1,
        updated_at = excluded.updated_at
      WHERE excluded.last_d1_write_at >= COALESCE(cart_activity.last_d1_write_at, '')`,
    ).bind(
      this.state.id.toString(),
      contact?.phone ?? null,
      contact?.email ?? null,
      contact?.name ?? null,
      cart.items.length,
      cart.items.reduce((sum, i) => sum + i.quantity, 0),
      cart.last_mutation_at,
      contact?.consent_status ?? 'unknown',
      now,
      writeSource,
      nextSeq,
    ).run();

    cart.last_d1_write_seq = nextSeq;
    cart.last_persisted_at = now;
    await this.persist();
  }
}
