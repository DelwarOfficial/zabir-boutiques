import { useState, useEffect, useCallback } from 'react';
import { categorizeAction, actionLabel, formatEntityType, type AuditEntryWithActor } from '../../types/audit';

interface Props {
  initialEntries: AuditEntryWithActor[];
  total: number;
  page: number;
  totalPages: number;
  csrfToken: string;
}

function getCsrf(): string {
  if (typeof window.__ZB_CSRF__ === 'string' && window.__ZB_CSRF__) return window.__ZB_CSRF__;
  try { return sessionStorage.getItem('zb-csrf') || ''; } catch { return ''; }
}

interface ActionTypeOption {
  action: string;
  count: number;
}

interface AuditActionsResponse {
  ok?: boolean;
  types?: ActionTypeOption[];
}

interface AuditPageResponse {
  ok?: boolean;
  error?: string;
  entries?: AuditEntryWithActor[];
  total?: number;
  page?: number;
  totalPages?: number;
}

function formatDate(dateStr: string): string {
  const d = dateStr.replace(' ', 'T') + 'Z';
  try { return new Date(d).toLocaleString(); } catch { return dateStr; }
}

function shortId(id: string): string {
  return id?.substring(0, 8) || '…';
}

function ActionBadge({ action }: { action: string }) {
  const cat = categorizeAction(action);
  const colors: Record<string, string> = {
    'Staff & Auth': 'bg-sky-100 text-sky-800',
    'Roles & Permissions': 'bg-violet-100 text-violet-800',
    'Orders': 'bg-blue-100 text-blue-800',
    'Coupons': 'bg-emerald-100 text-emerald-800',
    'Payments': 'bg-amber-100 text-amber-800',
    'Fraud': 'bg-red-100 text-red-800',
    'Inventory': 'bg-teal-100 text-teal-800',
    'Products': 'bg-pink-100 text-pink-800',
    'Media': 'bg-purple-100 text-purple-800',
    'Security / 2FA': 'bg-orange-100 text-orange-800',
    'System': 'bg-slate-100 text-slate-800',
    'API Keys': 'bg-indigo-100 text-indigo-800',
    'Customers': 'bg-lime-100 text-lime-800',
    'AI': 'bg-cyan-100 text-cyan-800',
  };
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${colors[cat] || 'bg-gray-100 text-gray-800'}`}>
      {cat}
    </span>
  );
}

function DetailModal({ entry, onClose }: { entry: AuditEntryWithActor; onClose: () => void }) {
  let metadata: Record<string, unknown> | null = null;
  if (entry.metadata_json) {
    try { metadata = JSON.parse(entry.metadata_json); } catch { /* not JSON */ }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="bg-surface rounded-xl border border-line shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <h2 className="text-lg font-extrabold m-0">Audit Entry</h2>
          <button type="button" onClick={onClose} className="press text-muted hover:text-ink text-xl leading-none">&times;</button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <ActionBadge action={entry.action} />
            <span className="text-sm font-semibold">{actionLabel(entry.action)}</span>
            <code className="text-[11px] text-muted font-mono">{entry.action}</code>
          </div>

          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="p-2.5 rounded-lg bg-surface-soft">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1">Date & Time</p>
              <p className="font-semibold tabular-nums">{formatDate(entry.created_at)}</p>
            </div>
            <div className="p-2.5 rounded-lg bg-surface-soft">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1">Staff</p>
              <p className="font-semibold">{entry.actor_name || 'Unknown'}</p>
              {entry.actor_role && <p className="text-[11px] text-muted">{entry.actor_role}</p>}
            </div>
            <div className="p-2.5 rounded-lg bg-surface-soft">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1">Entity</p>
              <p className="font-semibold">{formatEntityType(entry.entity_type)}</p>
              <code className="text-[11px] text-muted font-mono">{shortId(entry.entity_id)}</code>
            </div>
            <div className="p-2.5 rounded-lg bg-surface-soft">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1">IP Address</p>
              <p className="font-mono text-[13px]">{entry.ip_address || '—'}</p>
            </div>
          </div>

          {entry.chain_hash && (
            <div className="p-2.5 rounded-lg bg-surface-soft">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1">Chain Integrity</p>
              <div className="space-y-0.5">
                <p className="text-[11px] font-mono text-muted break-all">
                  <span className="text-ink-secondary font-semibold">Previous: </span>
                  {entry.previous_hash ? shortId(entry.previous_hash) : '(genesis)'}
                </p>
                <p className="text-[11px] font-mono text-muted break-all">
                  <span className="text-ink-secondary font-semibold">Chain: </span>
                  {shortId(entry.chain_hash)}
                </p>
              </div>
            </div>
          )}

          {metadata && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted mb-1.5">Metadata</p>
              <div className="rounded-lg border border-line overflow-hidden">
                <table className="w-full text-xs border-collapse">
                  <tbody>
                    {Object.entries(metadata).map(([key, val]) => {
                      const isPriorKey = key.startsWith('previous_') || key.startsWith('old_') || key === 'previous';
                      const isNewKey = key.startsWith('new_') || key.startsWith('current_') || key === 'new';
                      const valStr = val === null ? '—' : typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val);
                      const isDiff = isPriorKey || isNewKey;
                      return (
                        <tr key={key} className="border-t border-line">
                          <td className="px-2.5 py-1.5 text-muted font-mono whitespace-nowrap">{key}</td>
                          <td className={`px-2.5 py-1.5 font-mono break-all ${isPriorKey ? 'text-red-700 bg-red-50' : ''} ${isNewKey ? 'text-green-700 bg-green-50' : ''}`}>
                            {isDiff && (isPriorKey ? '← ' : '→ ')}
                            {valStr}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end px-5 py-4 border-t border-line bg-surface-soft rounded-b-xl">
          <button type="button" onClick={onClose} className="press px-4 py-2 text-sm font-semibold rounded-lg border border-line bg-surface text-ink">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export function AuditLogViewer({ initialEntries, total: initialTotal, page: initialPage, totalPages: initialTotalPages, csrfToken: _csrf }: Props) {
  const [entries, setEntries] = useState<AuditEntryWithActor[]>(initialEntries);
  const [total, setTotal] = useState(initialTotal);
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [totalPages, setTotalPages] = useState(initialTotalPages);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detailEntry, setDetailEntry] = useState<AuditEntryWithActor | null>(null);

  // Filters
  const [filterAction, setFilterAction] = useState('');
  const [filterEntityType, setFilterEntityType] = useState('');
  const [filterEntityId, setFilterEntityId] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [actionTypes, setActionTypes] = useState<ActionTypeOption[]>([]);

  useEffect(() => {
    window.__ZB_CSRF__ = _csrf;
    fetch('/api/staff/audit/actions', {
      headers: { 'X-CSRF-Token': getCsrf() }
    }).then(r => r.json() as Promise<AuditActionsResponse>).then(d => {
      if (d.ok) setActionTypes(d.types ?? []);
    }).catch(() => {});
  }, [_csrf]);

  const fetchPage = useCallback(async (page: number) => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ page: String(page), limit: '50' });
      if (filterAction) params.set('action', filterAction);
      if (filterEntityType) params.set('entity_type', filterEntityType);
      if (filterEntityId) params.set('entity_id', filterEntityId);
      if (filterDateFrom) params.set('date_from', filterDateFrom);
      if (filterDateTo) params.set('date_to', filterDateTo);

      const res = await fetch(`/api/staff/audit?${params}`, {
        headers: { 'X-CSRF-Token': getCsrf() }
      });
      const data = await res.json() as AuditPageResponse;
      if (!data.ok) throw new Error(data.error || 'Failed');
      setEntries(data.entries ?? []);
      setTotal(data.total ?? 0);
      setCurrentPage(data.page ?? page);
      setTotalPages(data.totalPages ?? 1);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filterAction, filterEntityType, filterEntityId, filterDateFrom, filterDateTo]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    fetchPage(1);
  }

  function handleClear() {
    setFilterAction('');
    setFilterEntityType('');
    setFilterEntityId('');
    setFilterDateFrom('');
    setFilterDateTo('');
    fetchPage(1);
  }

  return (
    <div>
      {error && <div className="bg-red-100 text-red-800 px-4 py-2 rounded-lg text-sm mb-4">{error}</div>}

      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-muted">
          {total.toLocaleString()} entr{total === 1 ? 'y' : 'ies'}
          {totalPages > 1 && ` · Page ${currentPage}/${totalPages}`}
        </p>
        <button
          type="button"
          onClick={() => fetchPage(currentPage)}
          className="press text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-line bg-surface text-ink-secondary hover:bg-surface-soft flex items-center gap-1"
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
          Refresh
        </button>
      </div>

      <form onSubmit={handleSearch} className="flex flex-wrap gap-2 mb-4 items-end">
        <div>
          <label className="block text-[10px] font-semibold text-muted mb-0.5">Action Type</label>
          <select
            value={filterAction}
            onChange={e => setFilterAction(e.target.value)}
            className="px-2.5 py-1.5 border border-line rounded-md bg-surface text-ink text-xs w-44"
          >
            <option value="">All actions</option>
            {actionTypes.map(a => (
              <option key={a.action} value={a.action}>{a.action} ({a.count})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-muted mb-0.5">Entity Type</label>
          <input
            type="text"
            value={filterEntityType}
            onChange={e => setFilterEntityType(e.target.value)}
            placeholder="e.g. order, role"
            className="px-2.5 py-1.5 border border-line rounded-md bg-surface text-ink text-xs w-32"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-muted mb-0.5">Entity ID</label>
          <input
            type="text"
            value={filterEntityId}
            onChange={e => setFilterEntityId(e.target.value)}
            placeholder="UUID"
            className="px-2.5 py-1.5 border border-line rounded-md bg-surface text-ink text-xs w-36"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-muted mb-0.5">From</label>
          <input
            type="date"
            value={filterDateFrom}
            onChange={e => setFilterDateFrom(e.target.value)}
            className="px-2.5 py-1.5 border border-line rounded-md bg-surface text-ink text-xs w-36"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-muted mb-0.5">To</label>
          <input
            type="date"
            value={filterDateTo}
            onChange={e => setFilterDateTo(e.target.value)}
            className="px-2.5 py-1.5 border border-line rounded-md bg-surface text-ink text-xs w-36"
          />
        </div>
        <div className="flex gap-1">
          <button type="submit" className="px-3 py-1.5 bg-brand text-white rounded-md text-xs font-semibold border-0 cursor-pointer hover:brightness-110">
            Filter
          </button>
          {(filterAction || filterEntityType || filterEntityId || filterDateFrom || filterDateTo) && (
            <button type="button" onClick={handleClear} className="px-3 py-1.5 border border-line rounded-md text-xs text-muted bg-surface cursor-pointer hover:bg-surface-soft">
              Clear
            </button>
          )}
        </div>
      </form>

      {loading ? (
        <p className="text-sm text-muted py-8 text-center">Loading audit entries…</p>
      ) : entries.length === 0 ? (
        <div className="text-center text-muted text-sm py-8 border border-line rounded-lg">
          No audit entries match your filters.
        </div>
      ) : (
        <div className="overflow-x-auto border border-line rounded-lg">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="bg-surface-soft text-left">
                <th className="px-2.5 py-2 font-semibold whitespace-nowrap">Date</th>
                <th className="px-2.5 py-2 font-semibold">Action</th>
                <th className="px-2.5 py-2 font-semibold">Staff</th>
                <th className="px-2.5 py-2 font-semibold">Entity</th>
                <th className="px-2.5 py-2 font-semibold hidden sm:table-cell">IP</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(e => (
                <tr
                  key={e.id}
                  onClick={() => setDetailEntry(e)}
                  className="border-t border-line-soft hover:bg-surface-soft cursor-pointer transition-colors"
                >
                  <td className="px-2.5 py-1.5 whitespace-nowrap tabular-nums text-muted">
                    {formatDate(e.created_at)}
                  </td>
                  <td className="px-2.5 py-1.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <ActionBadge action={e.action} />
                      <span className="font-medium">{actionLabel(e.action)}</span>
                    </div>
                  </td>
                  <td className="px-2.5 py-1.5">
                    <span className="font-semibold">{e.actor_name || '—'}</span>
                    {e.actor_role && <span className="text-[10px] text-muted ml-1">({e.actor_role})</span>}
                  </td>
                  <td className="px-2.5 py-1.5">
                    <span className="text-muted">{formatEntityType(e.entity_type)}</span>
                    <code className="text-[10px] text-muted font-mono ml-1">#{shortId(e.entity_id)}</code>
                  </td>
                  <td className="px-2.5 py-1.5 font-mono text-[10px] text-muted hidden sm:table-cell">
                    {e.ip_address || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && !loading && (
        <div className="mt-4 flex items-center gap-2">
          <button
            type="button"
            onClick={() => fetchPage(currentPage - 1)}
            disabled={currentPage <= 1}
            className="press px-3 py-1.5 border border-line rounded-md text-xs font-semibold bg-surface hover:bg-surface-soft disabled:opacity-40 disabled:cursor-not-allowed"
          >
            &larr; Previous
          </button>
          <span className="text-xs text-muted">
            Page {currentPage} of {totalPages}
          </span>
          <button
            type="button"
            onClick={() => fetchPage(currentPage + 1)}
            disabled={currentPage >= totalPages}
            className="press px-3 py-1.5 border border-line rounded-md text-xs font-semibold bg-surface hover:bg-surface-soft disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next &rarr;
          </button>
          <span className="text-xs text-muted ml-auto">Showing {entries.length} of {total.toLocaleString()}</span>
        </div>
      )}

      {detailEntry && (
        <DetailModal entry={detailEntry} onClose={() => setDetailEntry(null)} />
      )}
    </div>
  );
}

export default AuditLogViewer;
