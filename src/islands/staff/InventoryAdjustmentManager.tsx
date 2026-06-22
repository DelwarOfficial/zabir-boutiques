import { useState, useEffect, useCallback } from 'react';
import type { InventoryVariant, InventoryMovement, AdjustStockResult, AdjustmentReason } from '../../types/inventory';
import { ADJUSTMENT_REASONS } from '../../types/inventory';

function getCsrf(): string {
  if (typeof window.__ZB_CSRF__ === 'string' && window.__ZB_CSRF__) return window.__ZB_CSRF__;
  try { return sessionStorage.getItem('zb-csrf') || ''; } catch { return ''; }
}

function formatDate(d: string): string {
  try { return new Date(d.replace(' ', 'T') + 'Z').toLocaleString(); } catch { return d; }
}

function timeAgo(d: string): string {
  try {
    const ms = Date.now() - new Date(d.replace(' ', 'T') + 'Z').getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  } catch { return d; }
}

function shortId(id: string | null): string {
  return id?.substring(0, 8) || '…';
}

interface VariantListResponse {
  ok?: boolean;
  error?: string;
  variants?: InventoryVariant[];
  total?: number;
  page?: number;
  totalPages?: number;
}

interface MovementListResponse {
  ok?: boolean;
  error?: string;
  movements?: InventoryMovement[];
  total?: number;
  page?: number;
  totalPages?: number;
}

type AdjustResponse = AdjustStockResult & { ok?: boolean; error?: string; message?: string };

function reasonLabel(reason: string): string {
  return ADJUSTMENT_REASONS.find(r => r.value === reason)?.label || reason;
}

function getDeltaBadgeClass(delta: number): string {
  return delta > 0
    ? 'text-emerald-600 bg-emerald-50'
    : 'text-red-600 bg-red-50';
}

function cn(...classes: (string | false | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}

function SearchIcon() { return <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>; }
function PlusIcon() { return <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5v14"/></svg>; }
function MinusIcon() { return <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14"/></svg>; }
function XIcon() { return <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>; }
function AlertIcon() { return <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4M12 17h.01"/><path d="M3.09 21h17.82a1 1 0 0 0 .86-1.5L13.13 3.4a1 1 0 0 0-1.74 0L2.23 19.5a1 1 0 0 0 .86 1.5z"/></svg>; }

export default function InventoryAdjustmentManager() {
  const [tab, setTab] = useState<'variants' | 'movements'>('variants');

  // Variants tab state
  const [search, setSearch] = useState('');
  const [variants, setVariants] = useState<InventoryVariant[]>([]);
  const [vTotal, setVTotal] = useState(0);
  const [vPage, setVPage] = useState(1);
  const [vTotalPages, setVTotalPages] = useState(1);
  const [vLoading, setVLoading] = useState(false);
  const [vError, setVError] = useState('');

  // Movements tab state
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [mTotal, setMTotal] = useState(0);
  const [mPage, setMPage] = useState(1);
  const [mTotalPages, setMTotalPages] = useState(1);
  const [mLoading, setMLoading] = useState(false);
  const [mError, setMError] = useState('');
  const [mFilterVariant, setMFilterVariant] = useState('');
  const [mFilterReason, setMFilterReason] = useState('');

  // Adjust dialog state
  const [adjustTarget, setAdjustTarget] = useState<InventoryVariant | null>(null);
  const [delta, setDelta] = useState(0);
  const [adjReason, setAdjReason] = useState('correction');
  const [adjNotes, setAdjNotes] = useState('');
  const [adjSubmitting, setAdjSubmitting] = useState(false);
  const [adjError, setAdjError] = useState('');
  const [confirmStep, setConfirmStep] = useState(false);
  const [adjSuccess, setAdjSuccess] = useState<AdjustStockResult | null>(null);

  const fetchVariants = useCallback(async (p: number) => {
    setVLoading(true);
    setVError('');
    try {
      const params = new URLSearchParams({ page: String(p), limit: '50' });
      if (search) params.set('search', search);
      const res = await fetch(`/api/staff/inventory/variants?${params}`, {
        headers: { 'X-CSRF-Token': getCsrf() },
      });
      const data = await res.json() as VariantListResponse;
      if (data.ok) {
        setVariants(data.variants ?? []);
        setVTotal(data.total ?? 0);
        setVPage(data.page ?? p);
        setVTotalPages(data.totalPages ?? 1);
      } else setVError(data.error || 'Failed to load');
    } catch { setVError('Network error'); }
    finally { setVLoading(false); }
  }, [search]);

  const fetchMovements = useCallback(async (p: number) => {
    setMLoading(true);
    setMError('');
    try {
      const params = new URLSearchParams({ page: String(p), limit: '50' });
      if (mFilterVariant) params.set('variantId', mFilterVariant);
      if (mFilterReason) params.set('reason', mFilterReason);
      const res = await fetch(`/api/staff/inventory/movements?${params}`, {
        headers: { 'X-CSRF-Token': getCsrf() },
      });
      const data = await res.json() as MovementListResponse;
      if (data.ok) {
        setMovements(data.movements ?? []);
        setMTotal(data.total ?? 0);
        setMPage(data.page ?? p);
        setMTotalPages(data.totalPages ?? 1);
      } else setMError(data.error || 'Failed to load');
    } catch { setMError('Network error'); }
    finally { setMLoading(false); }
  }, [mFilterVariant, mFilterReason]);

  useEffect(() => { if (tab === 'variants') fetchVariants(1); }, [tab]);
  useEffect(() => { if (tab === 'movements') fetchMovements(1); }, [tab]);

  function openAdjust(v: InventoryVariant) {
    setAdjustTarget(v);
    setDelta(0);
    setAdjReason('correction');
    setAdjNotes('');
    setAdjError('');
    setConfirmStep(false);
    setAdjSuccess(null);
  }

  function closeAdjust() {
    setAdjustTarget(null);
    setDelta(0);
    setAdjError('');
    setConfirmStep(false);
    setAdjSuccess(null);
  }

  async function submitAdjust() {
    if (!adjustTarget) return;
    setAdjSubmitting(true);
    setAdjError('');
    try {
      const res = await fetch('/api/staff/inventory/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrf() },
        body: JSON.stringify({ variantId: adjustTarget.variantId, delta, reason: adjReason, notes: adjNotes || undefined }),
      });
      const data = await res.json() as AdjustResponse;
      if (data.ok) {
        setAdjSuccess(data);
        setConfirmStep(false);
        fetchVariants(vPage);
        fetchMovements(1);
      } else setAdjError(data.error || data.message || 'Adjustment failed');
    } catch { setAdjError('Network error'); }
    finally { setAdjSubmitting(false); }
  }

  const selectedReason = ADJUSTMENT_REASONS.find(r => r.value === adjReason);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: '0', borderBottom: '2px solid var(--line, #e5e7eb)', marginBottom: '1rem' }}>
        <button onClick={() => setTab('variants')}
          style={{ padding: '0.6rem 1.2rem', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', border: 'none', background: 'none',
            borderBottom: tab === 'variants' ? '2px solid var(--brand, #6366f1)' : '2px solid transparent',
            color: tab === 'variants' ? 'var(--brand, #6366f1)' : 'var(--muted, #6b7280)', marginBottom: '-2px' }}>
          Variants
        </button>
        <button onClick={() => setTab('movements')}
          style={{ padding: '0.6rem 1.2rem', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', border: 'none', background: 'none',
            borderBottom: tab === 'movements' ? '2px solid var(--brand, #6366f1)' : '2px solid transparent',
            color: tab === 'movements' ? 'var(--brand, #6366f1)' : 'var(--muted, #6b7280)', marginBottom: '-2px' }}>
          Movement Log
        </button>
      </div>

      {/* ───── VARIANT SEARCH TAB ───── */}
      {tab === 'variants' && (
        <div>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: 1, maxWidth: '320px' }}>
              <span style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', opacity: 0.4 }}>
                <SearchIcon />
              </span>
              <input
                type="text" placeholder="Search by product name, SKU, size, color..."
                value={search} onChange={e => setSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && fetchVariants(1)}
                style={{ width: '100%', padding: '0.45rem 0.45rem 0.45rem 1.8rem', fontSize: '0.8rem', border: '1px solid var(--line, #d1d5db)', borderRadius: '6px', outline: 'none' }}
              />
            </div>
            <button onClick={() => fetchVariants(1)}
              style={{ padding: '0.45rem 0.9rem', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', border: '1px solid var(--brand, #6366f1)', borderRadius: '6px', background: 'var(--brand, #6366f1)', color: '#fff' }}>
              Search
            </button>
          </div>

          {vError && (
            <div style={{ padding: '0.5rem 0.75rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', color: '#991b1b', fontSize: '0.8rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <AlertIcon /> {vError}
            </div>
          )}

          <div style={{ overflowX: 'auto', border: '1px solid var(--line, #e5e7eb)', borderRadius: '8px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ background: 'var(--surface-soft, #f9fafb)', textAlign: 'left' }}>
                  <th style={{ padding: '0.5rem 0.6rem', fontWeight: 600, whiteSpace: 'nowrap' }}>Product</th>
                  <th style={{ padding: '0.5rem 0.6rem', fontWeight: 600, whiteSpace: 'nowrap' }}>SKU</th>
                  <th style={{ padding: '0.5rem 0.6rem', fontWeight: 600, whiteSpace: 'nowrap' }}>Size/Color</th>
                  <th style={{ padding: '0.5rem 0.6rem', fontWeight: 600, whiteSpace: 'nowrap', textAlign: 'right' }}>On Hand</th>
                  <th style={{ padding: '0.5rem 0.6rem', fontWeight: 600, whiteSpace: 'nowrap', textAlign: 'right' }}>Reserved</th>
                  <th style={{ padding: '0.5rem 0.6rem', fontWeight: 600, whiteSpace: 'nowrap', textAlign: 'right' }}>Available</th>
                  <th style={{ padding: '0.5rem 0.6rem', fontWeight: 600, whiteSpace: 'nowrap', textAlign: 'right' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {vLoading ? (
                  <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted, #6b7280)' }}>Loading...</td></tr>
                ) : variants.length === 0 ? (
                  <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted, #6b7280)' }}>No variants found.</td></tr>
                ) : variants.map(v => (
                  <tr key={v.id} style={{ borderTop: '1px solid var(--line-soft, #f3f4f6)' }}>
                    <td style={{ padding: '0.5rem 0.6rem', fontWeight: 500, color: 'var(--brand, #6366f1)' }}>{v.productName}</td>
                    <td style={{ padding: '0.5rem 0.6rem', fontFamily: 'monospace', fontSize: '0.75rem' }}>{v.sku}</td>
                    <td style={{ padding: '0.5rem 0.6rem', color: 'var(--muted, #6b7280)' }}>{[v.size, v.color].filter(Boolean).join(' / ') || '—'}</td>
                    <td style={{ padding: '0.5rem 0.6rem', textAlign: 'right', fontWeight: 600, color: v.quantity === 0 ? '#dc2626' : '#92400e' }}>{v.quantity}</td>
                    <td style={{ padding: '0.5rem 0.6rem', textAlign: 'right', color: 'var(--muted, #6b7280)' }}>{v.reserved}</td>
                    <td style={{ padding: '0.5rem 0.6rem', textAlign: 'right', fontWeight: 600, color: v.available <= 0 ? '#dc2626' : v.available <= 5 ? '#f59e0b' : '#16a34a' }}>{v.available}</td>
                    <td style={{ padding: '0.5rem 0.6rem', textAlign: 'right' }}>
                      <button onClick={() => openAdjust(v)}
                        style={{ padding: '0.3rem 0.7rem', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', border: '1px solid var(--brand, #6366f1)', borderRadius: '5px', background: 'var(--brand, #6366f1)', color: '#fff' }}>
                        Adjust
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {vTotalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: '0.25rem', marginTop: '0.75rem', alignItems: 'center', fontSize: '0.8rem' }}>
              <button disabled={vPage <= 1} onClick={() => fetchVariants(vPage - 1)}
                style={{ padding: '0.3rem 0.6rem', cursor: vPage > 1 ? 'pointer' : 'default', border: '1px solid var(--line, #d1d5db)', borderRadius: '4px', background: vPage > 1 ? '#fff' : '#f3f4f6', opacity: vPage > 1 ? 1 : 0.5 }}>
                Prev
              </button>
              <span style={{ color: 'var(--muted, #6b7280)' }}>Page {vPage} of {vTotalPages} ({vTotal} variants)</span>
              <button disabled={vPage >= vTotalPages} onClick={() => fetchVariants(vPage + 1)}
                style={{ padding: '0.3rem 0.6rem', cursor: vPage < vTotalPages ? 'pointer' : 'default', border: '1px solid var(--line, #d1d5db)', borderRadius: '4px', background: vPage < vTotalPages ? '#fff' : '#f3f4f6', opacity: vPage < vTotalPages ? 1 : 0.5 }}>
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {/* ───── MOVEMENT LOG TAB ───── */}
      {tab === 'movements' && (
        <div>
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <input type="text" placeholder="Filter by variant ID..." value={mFilterVariant}
              onChange={e => setMFilterVariant(e.target.value)}
              style={{ padding: '0.4rem 0.6rem', fontSize: '0.8rem', border: '1px solid var(--line, #d1d5db)', borderRadius: '6px', outline: 'none', width: '180px' }} />
            <select value={mFilterReason} onChange={e => setMFilterReason(e.target.value)}
              style={{ padding: '0.4rem 0.6rem', fontSize: '0.8rem', border: '1px solid var(--line, #d1d5db)', borderRadius: '6px', outline: 'none', background: '#fff' }}>
              <option value="">All reasons</option>
              {ADJUSTMENT_REASONS.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            <button onClick={() => fetchMovements(1)}
              style={{ padding: '0.4rem 0.8rem', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', border: '1px solid var(--brand, #6366f1)', borderRadius: '6px', background: 'var(--brand, #6366f1)', color: '#fff' }}>
              Filter
            </button>
          </div>

          {mError && (
            <div style={{ padding: '0.5rem 0.75rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', color: '#991b1b', fontSize: '0.8rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <AlertIcon /> {mError}
            </div>
          )}

          <div style={{ overflowX: 'auto', border: '1px solid var(--line, #e5e7eb)', borderRadius: '8px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ background: 'var(--surface-soft, #f9fafb)', textAlign: 'left' }}>
                  <th style={{ padding: '0.5rem 0.6rem', fontWeight: 600, whiteSpace: 'nowrap' }}>Type</th>
                  <th style={{ padding: '0.5rem 0.6rem', fontWeight: 600, whiteSpace: 'nowrap' }}>Product / SKU</th>
                  <th style={{ padding: '0.5rem 0.6rem', fontWeight: 600, whiteSpace: 'nowrap' }}>Reason</th>
                  <th style={{ padding: '0.5rem 0.6rem', fontWeight: 600, whiteSpace: 'nowrap' }}>Notes</th>
                  <th style={{ padding: '0.5rem 0.6rem', fontWeight: 600, whiteSpace: 'nowrap', textAlign: 'right' }}>Change</th>
                  <th style={{ padding: '0.5rem 0.6rem', fontWeight: 600, whiteSpace: 'nowrap', textAlign: 'right' }}>By</th>
                  <th style={{ padding: '0.5rem 0.6rem', fontWeight: 600, whiteSpace: 'nowrap', textAlign: 'right' }}>Time</th>
                </tr>
              </thead>
              <tbody>
                {mLoading ? (
                  <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted, #6b7280)' }}>Loading...</td></tr>
                ) : movements.length === 0 ? (
                  <tr><td colSpan={7} style={{ padding: '2rem', textAlign: 'center', color: 'var(--muted, #6b7280)' }}>No movements recorded yet.</td></tr>
                ) : movements.map(m => (
                  <tr key={m.id} style={{ borderTop: '1px solid var(--line-soft, #f3f4f6)' }}>
                    <td style={{ padding: '0.5rem 0.6rem' }}>
                      <span style={{ display: 'inline-block', padding: '1px 6px', borderRadius: '4px', fontSize: '0.7rem', fontWeight: 600, whiteSpace: 'nowrap',
                        background: m.delta > 0 ? '#dcfce7' : '#fee2e2', color: m.delta > 0 ? '#166534' : '#991b1b' }}>
                        {m.delta > 0 ? 'Addition' : 'Removal'}
                      </span>
                    </td>
                    <td style={{ padding: '0.5rem 0.6rem' }}>
                      <div style={{ fontWeight: 500 }}>{m.productName}</div>
                      <div style={{ fontFamily: 'monospace', fontSize: '0.7rem', color: 'var(--muted, #6b7280)' }}>{m.sku}</div>
                    </td>
                    <td style={{ padding: '0.5rem 0.6rem', whiteSpace: 'nowrap' }}>
                      <span style={{ fontSize: '0.7rem', color: 'var(--muted, #6b7280)' }}>{reasonLabel(m.reason)}</span>
                    </td>
                    <td style={{ padding: '0.5rem 0.6rem', color: 'var(--muted, #6b7280)', fontSize: '0.75rem', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.notes || '—'}
                    </td>
                    <td style={{ padding: '0.5rem 0.6rem', textAlign: 'right' }}>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: m.delta > 0 ? '#16a34a' : '#dc2626' }}>
                        {m.delta > 0 ? '+' : ''}{m.delta}
                      </div>
                      {(m.prevQuantity != null && m.newQuantity != null) && (
                        <div style={{ fontSize: '0.65rem', color: 'var(--muted, #6b7280)' }}>
                          {m.prevQuantity} → {m.newQuantity}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: '0.5rem 0.6rem', textAlign: 'right', fontSize: '0.75rem', color: 'var(--muted, #6b7280)' }}>
                      {m.adjustedByName || shortId(m.adjustedBy) || '—'}
                    </td>
                    <td style={{ padding: '0.5rem 0.6rem', textAlign: 'right', fontSize: '0.7rem', color: 'var(--muted, #6b7280)', whiteSpace: 'nowrap' }}>
                      <span title={formatDate(m.createdAt)}>{timeAgo(m.createdAt)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {mTotalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', gap: '0.25rem', marginTop: '0.75rem', alignItems: 'center', fontSize: '0.8rem' }}>
              <button disabled={mPage <= 1} onClick={() => fetchMovements(mPage - 1)}
                style={{ padding: '0.3rem 0.6rem', cursor: mPage > 1 ? 'pointer' : 'default', border: '1px solid var(--line, #d1d5db)', borderRadius: '4px', background: mPage > 1 ? '#fff' : '#f3f4f6', opacity: mPage > 1 ? 1 : 0.5 }}>
                Prev
              </button>
              <span style={{ color: 'var(--muted, #6b7280)' }}>Page {mPage} of {mTotalPages} ({mTotal} entries)</span>
              <button disabled={mPage >= mTotalPages} onClick={() => fetchMovements(mPage + 1)}
                style={{ padding: '0.3rem 0.6rem', cursor: mPage < mTotalPages ? 'pointer' : 'default', border: '1px solid var(--line, #d1d5db)', borderRadius: '4px', background: mPage < mTotalPages ? '#fff' : '#f3f4f6', opacity: mPage < mTotalPages ? 1 : 0.5 }}>
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {/* ───── ADJUSTMENT DIALOG ───── */}
      {adjustTarget && !adjSuccess && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={e => e.target === e.currentTarget && !adjSubmitting && closeAdjust()}>
          <div style={{ background: '#fff', borderRadius: '12px', width: '420px', maxWidth: '94vw', maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>
                  {confirmStep ? 'Confirm Adjustment' : 'Adjust Stock'}
                </h3>
                <p style={{ margin: '0.15rem 0 0', fontSize: '0.78rem', color: 'var(--muted, #6b7280)' }}>
                  {adjustTarget.productName}
                  <span style={{ fontFamily: 'monospace', marginLeft: '0.4rem' }}>{adjustTarget.sku}</span>
                </p>
              </div>
              <button onClick={closeAdjust} disabled={adjSubmitting}
                style={{ padding: '0.3rem', cursor: 'pointer', border: 'none', background: 'none', color: '#9ca3af', opacity: adjSubmitting ? 0.5 : 1 }}>
                <XIcon />
              </button>
            </div>

            <div style={{ padding: '1rem 1.25rem' }}>
              {!confirmStep ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {/* Current stock cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
                    {[
                      { label: 'On Hand', value: adjustTarget.quantity, color: '#92400e' },
                      { label: 'Reserved', value: adjustTarget.reserved, color: 'var(--muted, #6b7280)' },
                      { label: 'Available', value: adjustTarget.available, color: adjustTarget.available <= 0 ? '#dc2626' : '#16a34a' },
                    ].map(c => (
                      <div key={c.label} style={{ textAlign: 'center', padding: '0.5rem', background: '#f9fafb', borderRadius: '6px', border: '1px solid #f3f4f6' }}>
                        <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--muted, #6b7280)' }}>{c.label}</div>
                        <div style={{ fontSize: '1rem', fontWeight: 700, marginTop: '0.15rem', color: c.color }}>{c.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Delta input with +/- buttons */}
                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.3rem', display: 'block' }}>Adjustment Amount</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <button onClick={() => setDelta(d => d - 1)}
                        style={{ padding: '0.4rem', cursor: 'pointer', border: '1px solid #d1d5db', borderRadius: '6px', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '36px', height: '36px' }}>
                        <MinusIcon />
                      </button>
                      <input type="number" value={delta}
                        onChange={e => { const v = parseInt(e.target.value); setDelta(Number.isFinite(v) ? v : 0); }}
                        style={{ flex: 1, textAlign: 'center', fontWeight: 700, fontSize: '1rem', padding: '0.4rem', border: '1px solid #d1d5db', borderRadius: '6px', outline: 'none', height: '36px', boxSizing: 'border-box', MozAppearance: 'textfield' }} />
                      <button onClick={() => setDelta(d => d + 1)}
                        style={{ padding: '0.4rem', cursor: 'pointer', border: '1px solid #d1d5db', borderRadius: '6px', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '36px', height: '36px' }}>
                        <PlusIcon />
                      </button>
                    </div>
                    {delta !== 0 && (
                      <div style={{ marginTop: '0.4rem', textAlign: 'center', fontSize: '0.78rem', color: 'var(--muted, #6b7280)' }}>
                        New on hand: <b>{adjustTarget.quantity + delta}</b>
                        &nbsp;→&nbsp; New available: <b style={{ color: (adjustTarget.available + delta) <= 0 ? '#dc2626' : '#16a34a' }}>
                          {Math.max(0, adjustTarget.available + delta)}
                        </b>
                      </div>
                    )}
                  </div>

                  {/* Reason dropdown */}
                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.3rem', display: 'block' }}>Reason</label>
                    <select value={adjReason} onChange={e => { setAdjReason(e.target.value); setDelta(0); }}
                      style={{ width: '100%', padding: '0.4rem 0.6rem', fontSize: '0.8rem', border: '1px solid #d1d5db', borderRadius: '6px', outline: 'none', background: '#fff' }}>
                      {ADJUSTMENT_REASONS.map(r => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                    {selectedReason && (
                      <p style={{ margin: '0.3rem 0 0', fontSize: '0.72rem', color: 'var(--muted, #6b7280)' }}>{selectedReason.description}</p>
                    )}
                  </div>

                  {/* Notes */}
                  <div>
                    <label style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.3rem', display: 'block' }}>Notes <span style={{ fontWeight: 400, color: 'var(--muted, #6b7280)' }}>(optional)</span></label>
                    <textarea value={adjNotes} onChange={e => setAdjNotes(e.target.value)} maxLength={1000} rows={2}
                      placeholder="Add context for audit trail..."
                      style={{ width: '100%', padding: '0.4rem 0.6rem', fontSize: '0.8rem', border: '1px solid #d1d5db', borderRadius: '6px', outline: 'none', resize: 'vertical', fontFamily: 'inherit' }} />
                  </div>
                </div>
              ) : (
                /* Confirmation step */
                <div>
                  <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.8rem', display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}>
                    <AlertIcon />
                    <div>
                      <strong>Confirm stock change</strong><br />
                      This action is irreversible and will be recorded in the audit trail.
                    </div>
                  </div>
                  <table style={{ width: '100%', fontSize: '0.8rem', borderCollapse: 'collapse' }}>
                    <tbody>
                      <tr><td style={{ padding: '0.4rem 0', color: 'var(--muted, #6b7280)' }}>Product</td><td style={{ padding: '0.4rem 0', textAlign: 'right', fontWeight: 500 }}>{adjustTarget.productName}</td></tr>
                      <tr><td style={{ padding: '0.4rem 0', color: 'var(--muted, #6b7280)' }}>SKU</td><td style={{ padding: '0.4rem 0', textAlign: 'right', fontFamily: 'monospace' }}>{adjustTarget.sku}</td></tr>
                      <tr><td style={{ padding: '0.4rem 0', color: 'var(--muted, #6b7280)' }}>Change</td><td style={{ padding: '0.4rem 0', textAlign: 'right', fontWeight: 700, color: delta > 0 ? '#16a34a' : '#dc2626' }}>{delta > 0 ? '+' : ''}{delta}</td></tr>
                      <tr><td style={{ padding: '0.4rem 0', color: 'var(--muted, #6b7280)' }}>Current Stock</td><td style={{ padding: '0.4rem 0', textAlign: 'right' }}>{adjustTarget.quantity}</td></tr>
                      <tr><td style={{ padding: '0.4rem 0', color: 'var(--muted, #6b7280)' }}>New Stock</td><td style={{ padding: '0.4rem 0', textAlign: 'right', fontWeight: 700 }}>{adjustTarget.quantity + delta}</td></tr>
                      <tr><td style={{ padding: '0.4rem 0', color: 'var(--muted, #6b7280)' }}>Reason</td><td style={{ padding: '0.4rem 0', textAlign: 'right' }}>{selectedReason?.label || adjReason}</td></tr>
                      {adjNotes && <tr><td style={{ padding: '0.4rem 0', color: 'var(--muted, #6b7280)' }}>Notes</td><td style={{ padding: '0.4rem 0', textAlign: 'right', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{adjNotes}</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {adjError && (
              <div style={{ margin: '0 1.25rem 0.75rem', padding: '0.5rem 0.75rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', color: '#991b1b', fontSize: '0.78rem' }}>
                {adjError}
              </div>
            )}

            <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button onClick={closeAdjust} disabled={adjSubmitting}
                style={{ padding: '0.45rem 0.9rem', fontSize: '0.8rem', cursor: 'pointer', border: '1px solid #d1d5db', borderRadius: '6px', background: '#fff', fontWeight: 500, opacity: adjSubmitting ? 0.5 : 1 }}>
                Cancel
              </button>
              {!confirmStep ? (
                <button onClick={() => { if (delta === 0) { setAdjError('Adjustment amount cannot be zero'); return; } setConfirmStep(true); setAdjError(''); }}
                  disabled={delta === 0}
                  style={{ padding: '0.45rem 0.9rem', fontSize: '0.8rem', cursor: delta !== 0 ? 'pointer' : 'default', border: 'none', borderRadius: '6px', background: delta !== 0 ? 'var(--brand, #6366f1)' : '#d1d5db', color: delta !== 0 ? '#fff' : '#9ca3af', fontWeight: 600 }}>
                  Continue
                </button>
              ) : (
                <button onClick={submitAdjust} disabled={adjSubmitting}
                  style={{ padding: '0.45rem 0.9rem', fontSize: '0.8rem', cursor: adjSubmitting ? 'default' : 'pointer', border: 'none', borderRadius: '6px', background: adjSubmitting ? '#9ca3af' : (delta > 0 ? '#16a34a' : '#dc2626'), color: '#fff', fontWeight: 600, opacity: adjSubmitting ? 0.7 : 1 }}>
                  {adjSubmitting ? 'Applying...' : `Confirm ${delta > 0 ? '+' : ''}${delta}`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Success confirmation */}
      {adjSuccess && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={e => e.target === e.currentTarget && (closeAdjust())}>
          <div style={{ background: '#fff', borderRadius: '12px', width: '380px', maxWidth: '90vw', padding: '1.5rem', textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.75rem' }}>
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2"><path d="M20 6 9 17l-5-5"/></svg>
            </div>
            <h3 style={{ margin: '0 0 0.25rem', fontSize: '1rem', fontWeight: 700 }}>Stock Adjusted</h3>
            <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--muted, #6b7280)' }}>
              {adjSuccess.previousStock} → {adjSuccess.newStock} ({adjSuccess.delta > 0 ? '+' : ''}{adjSuccess.delta})
            </p>
            <button onClick={closeAdjust}
              style={{ marginTop: '1rem', padding: '0.5rem 1.5rem', fontSize: '0.85rem', cursor: 'pointer', border: 'none', borderRadius: '6px', background: 'var(--brand, #6366f1)', color: '#fff', fontWeight: 600 }}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
