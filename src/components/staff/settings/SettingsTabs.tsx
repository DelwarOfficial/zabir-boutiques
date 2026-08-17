import React, { useEffect, useState } from 'react';

const tabs = [
  { value: 'general', label: 'General & Brand' },
  { value: 'delivery', label: 'Delivery Rules' },
] as const;

interface SettingItem {
  key: string;
  value: string;
  type: string;
  label: string;
  description: string;
  group_name: string;
}

interface SettingsResponse {
  ok?: boolean;
  settings?: SettingItem[];
  error?: string;
}

function getCsrf(): string {
  if (typeof window.__ZB_CSRF__ === 'string' && window.__ZB_CSRF__) return window.__ZB_CSRF__;
  try { return sessionStorage.getItem('zb-csrf') || ''; } catch { return ''; }
}

function showToast(message: string, variant: 'success' | 'error' | 'info' = 'success'): void {
  if (typeof window.showToast === 'function') {
    window.showToast(message, variant);
  }
}

interface SettingsTabsProps {
  role?: string;
}

export const SettingsTabs: React.FC<SettingsTabsProps> = ({ role }) => {
  const isSuperAdmin = role === 'super_admin';
  const visibleTabs = isSuperAdmin ? [...tabs, { value: 'cache', label: 'Cache & Systems' } as const] : tabs;
  const [activeTab, setActiveTab] = useState('general');
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [, setError] = useState('');

  useEffect(() => {
    fetch('/api/staff/settings')
      .then((r) => r.json() as Promise<SettingsResponse>)
      .then((data) => {
        if (data.ok && data.settings) {
          const mapped: Record<string, string> = {};
          data.settings.forEach((s: SettingItem) => {
            mapped[s.key] = s.value;
          });
          setSettings(mapped);
        }
        setLoading(false);
      })
      .catch(() => {
        setError('Failed to load settings');
        setLoading(false);
      });
  }, []);

  const handleUpdate = async (key: string, value: string) => {
    setSaving(key);
    try {
      const res = await fetch('/api/staff/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrf() },
        body: JSON.stringify({ key, value }),
      });
      const data = await res.json() as SettingsResponse;
      if (data.ok) {
        setSettings((prev) => ({ ...prev, [key]: value }));
        showToast('Setting updated.', 'success');
      } else {
        showToast(data.error || 'Failed to update setting', 'error');
      }
    } catch {
      showToast('Network error while updating', 'error');
    } finally {
      setSaving(null);
    }
  };

  const handlePurgeCache = async () => {
    if (!confirm('Purge Cloudflare edge cache for storefront product, category, and stock data?')) return;
    setSaving('cache.purge');
    try {
      const res = await fetch('/api/staff/cache/purge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrf() },
        body: JSON.stringify({ tags: ['products', 'categories', 'stock'] }),
      });
      const data = await res.json() as SettingsResponse;
      if (!res.ok || !data.ok) throw new Error(data.error || 'Cache purge failed');
      showToast('Cache purge requested.', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Cache purge failed', 'error');
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return <div className="py-8 text-center text-sm text-muted">Loading settings...</div>;
  }

  const inputClass = 'w-full rounded-lg border border-line bg-surface p-2 text-sm outline-none focus:ring-2 focus:ring-brand/20';
  const inputWideClass = `${inputClass} max-w-lg`;
  const inputNarrowClass = `${inputClass} max-w-xs`;
  const savingClass = 'block text-xs text-muted';

  return (
    <div className="grid grid-cols-1 gap-8 md:grid-cols-4">
      <nav className="flex flex-col gap-1 md:col-span-1">
        {visibleTabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={`flex w-full items-center rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-all ${
              activeTab === tab.value
                ? 'bg-brand-light text-brand-strong'
                : 'text-muted hover:bg-surface-soft hover:text-ink'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <main className="rounded-2xl border border-line bg-surface p-6 shadow-sm md:col-span-3">
        {activeTab === 'general' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium text-ink">General Settings</h3>
              <p className="text-sm text-muted">Modify store branding, tagline, and contact information.</p>
            </div>
            <div className="h-px bg-line" />
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">Store Name</label>
                <input
                  type="text"
                  value={settings['store.name'] || ''}
                  onChange={(e) => setSettings({ ...settings, 'store.name': e.target.value })}
                  onBlur={(e) => handleUpdate('store.name', e.target.value)}
                  className={inputWideClass}
                />
                {saving === 'store.name' && <span className={savingClass}>Saving...</span>}
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Tagline</label>
                <input
                  type="text"
                  value={settings['store.tagline'] || ''}
                  onChange={(e) => setSettings({ ...settings, 'store.tagline': e.target.value })}
                  onBlur={(e) => handleUpdate('store.tagline', e.target.value)}
                  className={inputWideClass}
                />
                {saving === 'store.tagline' && <span className={savingClass}>Saving...</span>}
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Store Phone</label>
                <input
                  type="text"
                  value={settings['store.phone'] || ''}
                  onChange={(e) => setSettings({ ...settings, 'store.phone': e.target.value })}
                  onBlur={(e) => handleUpdate('store.phone', e.target.value)}
                  className={inputWideClass}
                />
                {saving === 'store.phone' && <span className={savingClass}>Saving...</span>}
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Facebook URL</label>
                <input
                  type="url"
                  value={settings['store.social_facebook'] || ''}
                  onChange={(e) => setSettings({ ...settings, 'store.social_facebook': e.target.value })}
                  onBlur={(e) => handleUpdate('store.social_facebook', e.target.value)}
                  className={inputWideClass}
                />
                {saving === 'store.social_facebook' && <span className={savingClass}>Saving...</span>}
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Instagram URL</label>
                <input
                  type="url"
                  value={settings['store.social_instagram'] || ''}
                  onChange={(e) => setSettings({ ...settings, 'store.social_instagram': e.target.value })}
                  onBlur={(e) => handleUpdate('store.social_instagram', e.target.value)}
                  className={inputWideClass}
                />
                {saving === 'store.social_instagram' && <span className={savingClass}>Saving...</span>}
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">WhatsApp URL</label>
                <input
                  type="url"
                  value={settings['store.social_whatsapp'] || ''}
                  onChange={(e) => setSettings({ ...settings, 'store.social_whatsapp': e.target.value })}
                  onBlur={(e) => handleUpdate('store.social_whatsapp', e.target.value)}
                  className={inputWideClass}
                />
                {saving === 'store.social_whatsapp' && <span className={savingClass}>Saving...</span>}
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Store Email</label>
                <input
                  type="email"
                  value={settings['store.email'] || ''}
                  onChange={(e) => setSettings({ ...settings, 'store.email': e.target.value })}
                  onBlur={(e) => handleUpdate('store.email', e.target.value)}
                  className={inputWideClass}
                />
                {saving === 'store.email' && <span className={savingClass}>Saving...</span>}
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Store Address</label>
                <textarea
                  value={settings['store.address'] || ''}
                  onChange={(e) => setSettings({ ...settings, 'store.address': e.target.value })}
                  onBlur={(e) => handleUpdate('store.address', e.target.value)}
                  rows={3}
                  className={inputWideClass}
                />
                {saving === 'store.address' && <span className={savingClass}>Saving...</span>}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'delivery' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium text-ink">Delivery Rules</h3>
              <p className="text-sm text-muted">Manage shipping fees for inside and outside Dhaka in Paisa (100 Paisa = ৳1).</p>
            </div>
            <div className="h-px bg-line" />
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">Delivery Inside Dhaka (Paisa)</label>
                <input
                  type="number"
                  value={settings['delivery_inside_dhaka_paisa'] || ''}
                  onChange={(e) => setSettings({ ...settings, 'delivery_inside_dhaka_paisa': e.target.value })}
                  onBlur={(e) => handleUpdate('delivery_inside_dhaka_paisa', e.target.value)}
                  className={inputNarrowClass}
                />
                {saving === 'delivery_inside_dhaka_paisa' && <span className={savingClass}>Saving...</span>}
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Delivery Outside Dhaka (Paisa)</label>
                <input
                  type="number"
                  value={settings['delivery_outside_dhaka_paisa'] || ''}
                  onChange={(e) => setSettings({ ...settings, 'delivery_outside_dhaka_paisa': e.target.value })}
                  onBlur={(e) => handleUpdate('delivery_outside_dhaka_paisa', e.target.value)}
                  className={inputNarrowClass}
                />
                {saving === 'delivery_outside_dhaka_paisa' && <span className={savingClass}>Saving...</span>}
              </div>
            </div>
          </div>
        )}

        {isSuperAdmin && activeTab === 'cache' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium text-ink">Cache & Systems</h3>
              <p className="text-sm text-muted">Manage CDN assets cache lifetime and triggers.</p>
            </div>
            <div className="h-px bg-line" />
            <div className="space-y-4">
              <button
                type="button"
                onClick={handlePurgeCache}
                disabled={saving === 'cache.purge'}
                className="rounded-lg bg-danger px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
              >
                {saving === 'cache.purge' ? 'Purging...' : 'Purge CDN Edge Cache'}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
