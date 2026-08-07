import type { APIContext } from 'astro';
import { getEnv } from '../../../lib/env';

const PUBLIC_KEYS = [
  'store.name',
  'store.tagline',
  'store.phone',
  'store.email',
  'store.address',
  'store.social_facebook',
  'store.social_instagram',
  'store.social_whatsapp',
  'delivery_inside_dhaka_paisa',
  'delivery_outside_dhaka_paisa',
] as const;

const DEFAULTS: Record<string, string> = {
  'store.name': 'Zabir Boutiques',
  'store.tagline': 'Premium Pakistani & Indian Fashion',
  'store.phone': '+8801712345678',
  'store.email': 'info@zabirboutiques.com',
  'store.address': 'House 12, Road 5, Gulshan 1, Dhaka 1212, Bangladesh',
  'store.social_facebook': 'https://facebook.com/zabirboutiques',
  'store.social_instagram': 'https://instagram.com/zabirboutiques',
  'store.social_whatsapp': 'https://wa.me/8801712345678',
  'delivery_inside_dhaka_paisa': '70',
  'delivery_outside_dhaka_paisa': '150',
};

export async function GET(context: APIContext): Promise<Response> {
  const env = getEnv(context);
  const settings: Record<string, string> = { ...DEFAULTS };

  try {
    const placeholders = PUBLIC_KEYS.map(() => '?').join(',');
    const rows = await env.DB.prepare(
      `SELECT key, value FROM site_settings WHERE key IN (${placeholders})`
    ).bind(...PUBLIC_KEYS).all<{ key: string; value: string }>();

    if (rows.results) {
      for (const row of rows.results) {
        if (row.value) settings[row.key] = row.value;
      }
    }
  } catch {
    // Fallback to defaults on DB error
  }

  return Response.json({ ok: true, settings });
}
