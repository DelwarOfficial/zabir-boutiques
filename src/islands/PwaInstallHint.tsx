import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'zb-pwa-install-dismissed';

export function PwaInstallHint() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (window.matchMedia('(display-mode: standalone)').matches) return;
    if (localStorage.getItem(DISMISS_KEY) === '1') return;

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
      setVisible(true);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall);
  }, []);

  if (!visible || !deferred) return null;

  return (
    <div
      className="fixed inset-x-4 bottom-20 z-50 mx-auto max-w-md rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4 shadow-lg md:bottom-6"
      role="region"
      aria-label="Install app"
    >
      <p className="text-sm font-semibold text-[var(--ink)]">Install Zabir Boutiques</p>
      <p className="mt-1 text-xs text-[var(--muted)]">
        Add to your home screen for faster access to our storefront.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="rounded-md bg-[var(--brand)] px-3 py-1.5 text-xs font-semibold text-white"
          onClick={async () => {
            await deferred.prompt();
            await deferred.userChoice;
            setVisible(false);
            setDeferred(null);
          }}
        >
          Install
        </button>
        <button
          type="button"
          className="rounded-md border border-[var(--line)] px-3 py-1.5 text-xs text-[var(--ink-secondary)]"
          onClick={() => {
            localStorage.setItem(DISMISS_KEY, '1');
            setVisible(false);
            setDeferred(null);
          }}
        >
          Not now
        </button>
      </div>
    </div>
  );
}