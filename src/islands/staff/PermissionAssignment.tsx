import { useState } from 'react';
import { PERMISSION_GROUPS, type PermissionGroup } from '../../types/rbac';

interface Props {
  selected: string[];
  onChange: (permissions: string[]) => void;
}

function groupSelectedCount(group: PermissionGroup, selected: Set<string>): number {
  return group.permissions.filter(p => selected.has(p.name)).length;
}

function groupAllSelected(group: PermissionGroup, selected: Set<string>): boolean {
  return group.permissions.every(p => selected.has(p.name));
}

function CategoryIcon({ id }: { id: string }) {
  const icons: Record<string, string> = {
    orders: '🛒', payments: '💳', products: '📦', inventory: '📊',
    fraud: '🛡️', support: '💬', staff: '👥', settings: '⚙️',
    integrations: '🔗', api_keys: '🔑', api_code: '📋', backups: '💾',
    webhooks: '📡', media: '🖼️', reports: '📈', system: '🔧', platform: '🚀',
  };
  return <span className="mr-2 text-base">{icons[id] ?? '📄'}</span>;
}

export function PermissionAssignment({ selected, onChange }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(PERMISSION_GROUPS.map(g => g.category)));
  const selectedSet = new Set(selected);

  function toggleCategory(cat: string) {
    const next = new Set(expanded);
    if (next.has(cat)) next.delete(cat);
    else next.add(cat);
    setExpanded(next);
  }

  function handlePermissionToggle(perm: string) {
    const next = new Set(selectedSet);
    if (next.has(perm)) next.delete(perm);
    else next.add(perm);
    onChange(Array.from(next));
  }

  function handleCategoryToggle(group: PermissionGroup) {
    const next = new Set(selectedSet);
    const all = groupAllSelected(group, next);
    for (const p of group.permissions) {
      if (all) next.delete(p.name);
      else next.add(p.name);
    }
    onChange(Array.from(next));
  }

  return (
    <div className="space-y-2 max-h-[420px] overflow-y-auto rounded-lg border border-[var(--line)]">
      {PERMISSION_GROUPS.map(group => {
        const selCount = groupSelectedCount(group, selectedSet);
        const total = group.permissions.length;
        const isOpen = expanded.has(group.category);
        const allSel = groupAllSelected(group, selectedSet);
        return (
          <div key={group.category} className="border-b border-[var(--line)] last:border-b-0">
            <button
              type="button"
              onClick={() => toggleCategory(group.category)}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-soft)] transition-colors"
            >
              <span className={`shrink-0 text-[10px] text-[var(--muted)] transition-transform ${isOpen ? 'rotate-90' : ''}`}>▶</span>
              <CategoryIcon id={group.category} />
              <span className="flex-1">{group.label}</span>
              <span className="text-[11px] text-[var(--muted)] tabular-nums">{selCount}/{total}</span>
            </button>
            {isOpen && (
              <div className="px-3 pb-2 space-y-1">
                <label className="flex items-center gap-2 py-1 text-[12px] font-medium text-[var(--brand)] cursor-pointer hover:opacity-80">
                  <input
                    type="checkbox"
                    checked={allSel}
                    onChange={() => handleCategoryToggle(group)}
                    className="rounded border-[var(--line)] text-[var(--brand)] focus:ring-[var(--brand)]"
                  />
                  {allSel ? 'Deselect all' : 'Select all'} in {group.label}
                </label>
                {group.permissions.map(perm => (
                  <label
                    key={perm.name}
                    className="flex items-start gap-2 py-1 px-2 rounded hover:bg-[var(--surface-soft)] cursor-pointer group"
                  >
                    <input
                      type="checkbox"
                      checked={selectedSet.has(perm.name)}
                      onChange={() => handlePermissionToggle(perm.name)}
                      className="mt-0.5 rounded border-[var(--line)] text-[var(--brand)] focus:ring-[var(--brand)]"
                    />
                    <div className="min-w-0 flex-1">
                      <span className="text-sm font-medium text-[var(--ink)]">{perm.label}</span>
                      <p className="text-[11px] text-[var(--muted)] leading-tight mt-0.5">{perm.description}</p>
                      <code className="text-[10px] text-[var(--muted)] font-mono opacity-60 group-hover:opacity-100">{perm.name}</code>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
