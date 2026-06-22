import React, { useState, useEffect } from 'react';

const tabs = [
  { value: 'general', label: 'General & Brand' },
  { value: 'delivery', label: 'Delivery Rules' },
  { value: 'cache', label: 'Cache & Systems' },
] as const;

interface SettingItem {
  key: string;
  value: string;
  type: string;
  label: string;
  description: string;
  group_name: string;
}

export const SettingsTabs: React.FC = () => {
  const [activeTab, setActiveTab] = useState('general');
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/staff/settings')
      .then((r) => r.json())
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
      const data = await res.json();
      if (data.ok) {
        setSettings((prev) => ({ ...prev, [key]: value }));
      } else {
        alert(data.error || 'Failed to update setting');
      }
    } catch {
      alert('Network error while updating');
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return <div className="text-center py-8 text-muted-foreground text-sm">Loading settings...</div>;
  }

  return (
    <div className="grid grid-cols-1 gap-8 md:grid-cols-4">
      {/* Sidebar Nav */}
      <nav className="flex flex-col gap-1 md:col-span-1">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={`flex w-full items-center rounded-lg px-3 py-2.5 text-sm font-medium transition-all text-left ${
              activeTab === tab.value
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {/* Main Content Area */}
      <main className="md:col-span-3 border rounded-2xl bg-card p-6 shadow-sm">
        {activeTab === 'general' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium text-foreground">General Settings</h3>
              <p className="text-sm text-muted-foreground">Modify store branding, tagline, and contact information.</p>
            </div>
            <div className="h-px bg-border" />
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">Store Name</label>
                <input
                  type="text"
                  value={settings['store.name'] || ''}
                  onChange={(e) => setSettings({ ...settings, 'store.name': e.target.value })}
                  onBlur={() => handleUpdate('store.name', settings['store.name'])}
                  className="w-full max-w-lg rounded-lg border border-input p-2 bg-background outline-none focus:ring-2 focus:ring-ring text-sm"
                />
                {saving === 'store.name' && <span className="text-xs text-muted-foreground block">Saving...</span>}
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Tagline</label>
                <input
                  type="text"
                  value={settings['store.tagline'] || ''}
                  onChange={(e) => setSettings({ ...settings, 'store.tagline': e.target.value })}
                  onBlur={() => handleUpdate('store.tagline', settings['store.tagline'])}
                  className="w-full max-w-lg rounded-lg border border-input p-2 bg-background outline-none focus:ring-2 focus:ring-ring text-sm"
                />
                {saving === 'store.tagline' && <span className="text-xs text-muted-foreground block">Saving...</span>}
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Store Phone</label>
                <input
                  type="text"
                  value={settings['store.phone'] || ''}
                  onChange={(e) => setSettings({ ...settings, 'store.phone': e.target.value })}
                  onBlur={() => handleUpdate('store.phone', settings['store.phone'])}
                  className="w-full max-w-lg rounded-lg border border-input p-2 bg-background outline-none focus:ring-2 focus:ring-ring text-sm"
                />
                {saving === 'store.phone' && <span className="text-xs text-muted-foreground block">Saving...</span>}
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Store Email</label>
                <input
                  type="email"
                  value={settings['store.email'] || ''}
                  onChange={(e) => setSettings({ ...settings, 'store.email': e.target.value })}
                  onBlur={() => handleUpdate('store.email', settings['store.email'])}
                  className="w-full max-w-lg rounded-lg border border-input p-2 bg-background outline-none focus:ring-2 focus:ring-ring text-sm"
                />
                {saving === 'store.email' && <span className="text-xs text-muted-foreground block">Saving...</span>}
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Store Address</label>
                <textarea
                  value={settings['store.address'] || ''}
                  onChange={(e) => setSettings({ ...settings, 'store.address': e.target.value })}
                  onBlur={() => handleUpdate('store.address', settings['store.address'])}
                  rows={3}
                  className="w-full max-w-lg rounded-lg border border-input p-2 bg-background outline-none focus:ring-2 focus:ring-ring text-sm"
                />
                {saving === 'store.address' && <span className="text-xs text-muted-foreground block">Saving...</span>}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'delivery' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium text-foreground">Delivery Rules</h3>
              <p className="text-sm text-muted-foreground">Manage shipping fees for inside and outside Dhaka in Paisa (100 Paisa = ৳1).</p>
            </div>
            <div className="h-px bg-border" />
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">Delivery Inside Dhaka (Paisa)</label>
                <input
                  type="number"
                  value={settings['delivery_inside_dhaka_paisa'] || ''}
                  onChange={(e) => setSettings({ ...settings, 'delivery_inside_dhaka_paisa': e.target.value })}
                  onBlur={() => handleUpdate('delivery_inside_dhaka_paisa', settings['delivery_inside_dhaka_paisa'])}
                  className="w-full max-w-xs rounded-lg border border-input p-2 bg-background outline-none focus:ring-2 focus:ring-ring text-sm"
                />
                {saving === 'delivery_inside_dhaka_paisa' && <span className="text-xs text-muted-foreground block">Saving...</span>}
              </div>

              <div className="space-y-1">
                <label className="text-sm font-medium">Delivery Outside Dhaka (Paisa)</label>
                <input
                  type="number"
                  value={settings['delivery_outside_dhaka_paisa'] || ''}
                  onChange={(e) => setSettings({ ...settings, 'delivery_outside_dhaka_paisa': e.target.value })}
                  onBlur={() => handleUpdate('delivery_outside_dhaka_paisa', settings['delivery_outside_dhaka_paisa'])}
                  className="w-full max-w-xs rounded-lg border border-input p-2 bg-background outline-none focus:ring-2 focus:ring-ring text-sm"
                />
                {saving === 'delivery_outside_dhaka_paisa' && <span className="text-xs text-muted-foreground block">Saving...</span>}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'cache' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium text-foreground">Cache & Systems</h3>
              <p className="text-sm text-muted-foreground">Manage CDN assets cache lifetime and triggers.</p>
            </div>
            <div className="h-px bg-border" />
            <div className="space-y-4">
              <button 
                type="button"
                onClick={() => alert('Cache purge triggered.')}
                className="rounded-lg bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground hover:bg-destructive/90"
              >
                Purge CDN Edge Cache
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};
