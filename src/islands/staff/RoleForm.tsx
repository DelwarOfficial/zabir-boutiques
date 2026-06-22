import { useState } from 'react';
import { PermissionAssignment } from './PermissionAssignment';
import type { RoleWithPermissions } from '../../types/rbac';

interface Props {
  role?: RoleWithPermissions;
  onSave: (data: { name: string; display_name: string; description: string; permissions: string[] }) => Promise<void>;
  onCancel: () => void;
}

export function RoleForm({ role, onSave, onCancel }: Props) {
  const isEdit = !!role;
  const [name, setName] = useState(role?.name ?? '');
  const [displayName, setDisplayName] = useState(role?.display_name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [permissions, setPermissions] = useState<string[]>(role?.permissions ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!isEdit && !/^[a-z][a-z0-9_]*$/.test(name)) {
      setError('Role name must start with a letter and contain only lowercase letters, numbers, and underscores.');
      return;
    }
    if (!displayName.trim()) {
      setError('Display name is required.');
      return;
    }
    setSaving(true);
    try {
      await onSave({ name: name.trim(), display_name: displayName.trim(), description: description.trim(), permissions });
    } catch (err: any) {
      setError(err?.message ?? 'Failed to save role.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onCancel}>
      <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <form onSubmit={handleSubmit}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--line)]">
            <h2 className="text-lg font-extrabold m-0">{isEdit ? 'Edit Role' : 'Create Role'}</h2>
            <button type="button" onClick={onCancel} className="press text-[var(--muted)] hover:text-[var(--ink)] text-xl leading-none">&times;</button>
          </div>

          <div className="p-5 space-y-4">
            {error && (
              <div className="bg-red-100 text-red-800 px-3 py-2 rounded-lg text-sm">{error}</div>
            )}

            {!isEdit && (
              <div>
                <label className="block text-sm font-semibold text-[var(--ink)] mb-1">Role Key</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="control w-full px-3 py-2 text-sm rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] focus:border-[var(--brand)] focus:ring-1 focus:ring-[var(--brand)] outline-none"
                  placeholder="e.g. custom_role"
                  required
                  disabled={isEdit}
                />
                <p className="text-[11px] text-[var(--muted)] mt-1">Lowercase letters, numbers, underscores. Used as identifier.</p>
              </div>
            )}

            <div>
              <label className="block text-sm font-semibold text-[var(--ink)] mb-1">Display Name</label>
              <input
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                className="control w-full px-3 py-2 text-sm rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] focus:border-[var(--brand)] focus:ring-1 focus:ring-[var(--brand)] outline-none"
                placeholder="e.g. Custom Role"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-[var(--ink)] mb-1">Description</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                className="control w-full px-3 py-2 text-sm rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] focus:border-[var(--brand)] focus:ring-1 focus:ring-[var(--brand)] outline-none resize-none"
                rows={2}
                placeholder="What this role can do..."
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-[var(--ink)] mb-1">
                Permissions
                <span className="text-[var(--muted)] font-normal ml-1">({permissions.length} selected)</span>
              </label>
              <PermissionAssignment selected={permissions} onChange={setPermissions} />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[var(--line)] bg-[var(--surface-soft)] rounded-b-xl">
            <button
              type="button"
              onClick={onCancel}
              className="press px-4 py-2 text-sm font-semibold rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)] hover:bg-[var(--surface-soft)]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="press px-4 py-2 text-sm font-bold rounded-lg bg-[var(--brand)] text-white hover:brightness-110 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? 'Saving…' : isEdit ? 'Save Changes' : 'Create Role'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
