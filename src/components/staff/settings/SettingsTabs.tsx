import React, { useState } from 'react';

const tabs = [
  { value: 'general', label: 'General' },
  { value: 'checkout', label: 'Checkout' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'fraud', label: 'Fraud BD' },
  { value: 'cache', label: 'Cache & Systems' },
] as const;

export const SettingsTabs: React.FC = () => {
  const [activeTab, setActiveTab] = useState('general');

  return (
    <div className="grid grid-cols-1 gap-8 md:grid-cols-4">
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

      <main className="md:col-span-3 border rounded-2xl bg-card p-6 shadow-sm">
        {activeTab === 'general' && <GeneralSettingsSection />}
        {activeTab === 'checkout' && <CheckoutSettingsSection />}
        {activeTab === 'delivery' && <DeliverySettingsSection />}
        {activeTab === 'fraud' && <FraudSettingsSection />}
        {activeTab === 'cache' && <CacheSettingsSection />}
      </main>
    </div>
  );
};

const GeneralSettingsSection = () => (
  <div className="space-y-6">
    <div>
      <h3 className="text-lg font-medium text-foreground">General Settings</h3>
      <p className="text-sm text-muted-foreground">Modify store visual branding, identity details, and business settings.</p>
    </div>
    <div className="h-px bg-border" />
    <div className="grid grid-cols-1 gap-4">
      <div className="space-y-1">
        <label className="text-sm font-medium">Store Name</label>
        <input type="text" defaultValue="Zabir Boutiques" className="w-full max-w-lg rounded-lg border border-input p-2 bg-background outline-none focus:ring-2 focus:ring-ring" />
      </div>
    </div>
  </div>
);

const CheckoutSettingsSection = () => (
  <div className="space-y-6">
    <div>
      <h3 className="text-lg font-medium text-foreground">Checkout Settings</h3>
      <p className="text-sm text-muted-foreground">Configure payment threshold limits and rules.</p>
    </div>
    <div className="h-px bg-border" />
    <div className="grid grid-cols-1 gap-4">
      <p className="text-sm text-muted-foreground">Settings configuration options...</p>
    </div>
  </div>
);

const DeliverySettingsSection = () => (
  <div className="space-y-6">
    <div>
      <h3 className="text-lg font-medium text-foreground">Delivery Settings</h3>
      <p className="text-sm text-muted-foreground">Configure shipping fees and options.</p>
    </div>
    <div className="h-px bg-border" />
    <div className="grid grid-cols-1 gap-4">
      <p className="text-sm text-muted-foreground">Delivery options configuration...</p>
    </div>
  </div>
);

const FraudSettingsSection = () => (
  <div className="space-y-6">
    <div>
      <h3 className="text-lg font-medium text-foreground">FraudBD Settings</h3>
      <p className="text-sm text-muted-foreground">Configure FraudBD score boundaries.</p>
    </div>
    <div className="h-px bg-border" />
    <div className="grid grid-cols-1 gap-4">
      <p className="text-sm text-muted-foreground">Circuit breaker & limits config...</p>
    </div>
  </div>
);

const CacheSettingsSection = () => (
  <div className="space-y-6">
    <div>
      <h3 className="text-lg font-medium text-foreground">Cache & Systems</h3>
      <p className="text-sm text-muted-foreground">Flush edge caches or trigger backups.</p>
    </div>
    <div className="h-px bg-border" />
    <div className="grid grid-cols-1 gap-4">
      <button className="w-fit rounded-lg bg-destructive px-4 py-2 text-sm font-semibold text-destructive-foreground hover:bg-destructive/90">
        Purge Edge Cache
      </button>
    </div>
  </div>
);
