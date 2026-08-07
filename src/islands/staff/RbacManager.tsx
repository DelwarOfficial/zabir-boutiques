import { useState, useEffect, useCallback } from 'react';
import { RoleForm } from './RoleForm';
import type { RoleWithPermissions, StaffMember } from '../../types/rbac';

interface Props {
  initialRoles: RoleWithPermissions[];
  csrfToken: string;
}

function getCsrf(): string {
  if (typeof window.__ZB_CSRF__ === 'string' && window.__ZB_CSRF__) return window.__ZB_CSRF__;
  try { return sessionStorage.getItem('zb-csrf') || ''; } catch { return ''; }
}

async function api(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': getCsrf(),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json() as any;
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || data.message || `Request failed (${res.status})`);
  }
  return data;
}

export function RbacManager({ initialRoles, csrfToken: _csrf }: Props) {
  const [roles, setRoles] = useState<RoleWithPermissions[]>(initialRoles);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editRole, setEditRole] = useState<RoleWithPermissions | undefined>();
  const [detailRole, setDetailRole] = useState<RoleWithPermissions | undefined>();
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [staffLoading, setStaffLoading] = useState(false);

  useEffect(() => { window.__ZB_CSRF__ = _csrf; }, [_csrf]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api('GET', '/api/staff/roles');
      setRoles(data.roles ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  async function handleCreate(data: { name: string; display_name: string; description: string; permissions: string[] }) {
    await api('POST', '/api/staff/roles', data);
    setShowForm(false);
    await refresh();
  }

  async function handleUpdate(data: { name: string; display_name: string; description: string; permissions: string[] }) {
    if (!editRole) return;
    await api('PUT', `/api/staff/roles/${editRole.id}`, {
      display_name: data.display_name,
      description: data.description || null,
    });
    await api('PUT', `/api/staff/roles/${editRole.id}/permissions`, {
      permissions: data.permissions,
    });
    setEditRole(undefined);
    await refresh();
  }

  async function handleDelete(role: RoleWithPermissions) {
    if (!confirm(`Delete role "${role.display_name}"?\nThis cannot be undone.`)) return;
    try {
      await api('DELETE', `/api/staff/roles/${role.id}`);
      await refresh();
    } catch (err: any) {
      alert(err.message);
    }
  }

  async function showStaff(role: RoleWithPermissions) {
    setDetailRole(role);
    setStaffLoading(true);
    setStaffList([]);
    try {
      const data = await api('GET', `/api/staff/roles/${role.id}/staff`);
      setStaffList(data.staff ?? []);
    } catch (err: any) {
      alert(err.message);
    } finally {
      setStaffLoading(false);
    }
  }

  const roleColor = (r: RoleWithPermissions) => {
    if (r.name === 'super_admin') return 'chip-danger';
    if (r.name === 'owner') return 'chip-brand';
    return '';
  };

  return (
    <div>
      {error && (
        <div className="bg-red-100 text-red-800 px-4 py-2 rounded-lg text-sm mb-4">{error}</div>
      )}

      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-[var(--muted)]">{roles.length} role{roles.length !== 1 ? 's' : ''} defined</p>
        <button
          type="button"
          onClick={() => { setEditRole(undefined); setShowForm(true); }}
          className="press inline-flex items-center gap-1.5 rounded-full bg-[var(--brand)] text-white px-4 h-9 text-xs font-bold hover:brightness-110"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14"/></svg>
          Create Role
        </button>
      </div>

      {loading && <p className="text-sm text-[var(--muted)] py-4 text-center">Refreshing roles…</p>}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {roles.map(role => (
          <div key={role.id} className="shell-card p-4 border border-[var(--line)] rounded-xl bg-[var(--surface)]">
            <div className="flex items-start justify-between gap-2 mb-2">
              <div className="min-w-0">
                <h3 className="text-sm font-extrabold m-0 flex items-center gap-1.5">
                  {role.display_name}
                  {role.is_system && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--line-soft)] text-[var(--muted)] font-medium">system</span>
                  )}
                  <span className={`chip ${roleColor(role)} text-[10px]`}>{role.name}</span>
                </h3>
                {role.description && (
                  <p className="text-[12px] text-[var(--muted)] mt-1 leading-snug">{role.description}</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 text-[11px] text-[var(--muted)] mb-3">
              <span className="tabular-nums font-semibold">{role.permissions.length} permissions</span>
              <span className="tabular-nums font-semibold">{role.staff_count} staff</span>
              {role.updated_at && (
                <span className="text-[10px]">Updated {role.updated_at.split(' ')[0]}</span>
              )}
            </div>

            <div className="flex flex-wrap gap-1 mb-3">
              {role.permissions.slice(0, 6).map(p => (
                <code key={p} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--line-soft)] text-[var(--ink-secondary)] font-mono">
                  {p.split('.').pop()}
                </code>
              ))}
              {role.permissions.length > 6 && (
                <code className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--line-soft)] text-[var(--muted)] font-mono">
                  +{role.permissions.length - 6} more
                </code>
              )}
            </div>

            <div className="flex items-center gap-1.5 pt-2 border-t border-[var(--line)]">
              <button
                type="button"
                onClick={() => showStaff(role)}
                className="press text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-secondary)] hover:bg-[var(--surface-soft)] flex items-center gap-1"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                Staff
                {role.staff_count > 0 && <span className="tabular-nums">({role.staff_count})</span>}
              </button>
              <button
                type="button"
                onClick={() => { setEditRole(role); setShowForm(true); }}
                className="press text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--ink-secondary)] hover:bg-[var(--surface-soft)]"
              >
                Edit
              </button>
              {!role.is_system && (
                <button
                  type="button"
                  onClick={() => handleDelete(role)}
                  className="press text-[11px] font-semibold px-2.5 py-1.5 rounded-lg border border-[var(--danger)]/30 text-[var(--danger)] hover:bg-red-50 ml-auto"
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {showForm && (
        <RoleForm
          role={editRole}
          onSave={editRole ? handleUpdate : handleCreate}
          onCancel={() => { setShowForm(false); setEditRole(undefined); }}
        />
      )}

      {detailRole && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setDetailRole(undefined)}>
          <div className="bg-[var(--surface)] rounded-xl border border-[var(--line)] shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--line)]">
              <h2 className="text-lg font-extrabold m-0 flex items-center gap-2">
                {detailRole.display_name}
                <span className="chip text-[10px]">{detailRole.name}</span>
              </h2>
              <button type="button" onClick={() => setDetailRole(undefined)} className="press text-[var(--muted)] hover:text-[var(--ink)] text-xl leading-none">&times;</button>
            </div>
            <div className="p-5">
              <p className="text-sm text-[var(--muted)] mb-4">Staff members assigned to this role</p>
              {staffLoading ? (
                <p className="text-sm text-[var(--muted)] py-4 text-center">Loading staff…</p>
              ) : staffList.length === 0 ? (
                <p className="text-sm text-[var(--muted)] py-4 text-center">No staff assigned to this role.</p>
              ) : (
                <div className="space-y-2">
                  {staffList.map(s => (
                    <div key={s.id} className="flex items-center justify-between p-2.5 rounded-lg border border-[var(--line)]">
                      <div>
                        <p className="font-semibold text-sm">{s.full_name}</p>
                        <p className="text-[11px] text-[var(--muted)]">{s.email || s.phone || '—'}</p>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${s.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                        {s.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="flex items-center justify-end px-5 py-4 border-t border-[var(--line)] bg-[var(--surface-soft)] rounded-b-xl">
              <button
                type="button"
                onClick={() => setDetailRole(undefined)}
                className="press px-4 py-2 text-sm font-semibold rounded-lg border border-[var(--line)] bg-[var(--surface)] text-[var(--ink)]"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default RbacManager;
