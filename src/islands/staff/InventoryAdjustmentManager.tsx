import { useState, useEffect, useCallback } from 'react';
import type { InventoryVariant, InventoryMovement, AdjustStockResult } from '../../types/inventory';
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
    <div className="[font-family:system-ui,_sans-serif]">
      {/* Tab bar */}
      <div className="flex [gap:0] [border-bottom:2px_solid_var(--line,_#e5e7eb)] [margin-bottom:1rem]">
        <button onClick={() => setTab('variants')}
          className={`[padding:0.6rem_1.2rem] [font-size:0.85rem] [font-weight:600] cursor-pointer [border:none] [background:none] [margin-bottom:-2px] ${tab === 'variants' ? '[border-bottom:2px_solid_var(--brand,_#6366f1)] [color:var(--brand,_#6366f1)]' : '[border-bottom:2px_solid_transparent] [color:var(--muted,_#6b7280)]'}`}>
          Variants
        </button>
        <button onClick={() => setTab('movements')}
          className={`[padding:0.6rem_1.2rem] [font-size:0.85rem] [font-weight:600] cursor-pointer [border:none] [background:none] [margin-bottom:-2px] ${tab === 'movements' ? '[border-bottom:2px_solid_var(--brand,_#6366f1)] [color:var(--brand,_#6366f1)]' : '[border-bottom:2px_solid_transparent] [color:var(--muted,_#6b7280)]'}`}>
          Movement Log
        </button>
      </div>

      {/* ───── VARIANT SEARCH TAB ───── */}
      {tab === 'variants' && (
        <div>
          <div className="flex [gap:0.5rem] [margin-bottom:0.75rem] items-center">
            <div className="relative flex-1 [max-width:320px]">
              <span className="absolute [left:8px] [top:50%] [transform:translateY(-50%)] [opacity:0.4]">
                <SearchIcon />
              </span>
              <input
                type="text" placeholder="Search by product name, SKU, size, color..."
                value={search} onChange={e => setSearch(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && fetchVariants(1)}
                className="[width:100%] [padding:0.45rem_0.45rem_0.45rem_1.8rem] [font-size:0.8rem] [border:1px_solid_var(--line,_#d1d5db)] [border-radius:6px] [outline:none]"
              />
            </div>
            <button onClick={() => fetchVariants(1)}
              className="[padding:0.45rem_0.9rem] [font-size:0.8rem] [font-weight:600] cursor-pointer [border:1px_solid_var(--brand,_#6366f1)] [border-radius:6px] [background:var(--brand,_#6366f1)] [color:#fff]">
              Search
            </button>
          </div>

          {vError && (
            <div className="[padding:0.5rem_0.75rem] [background:#fef2f2] [border:1px_solid_#fecaca] [border-radius:6px] [color:#991b1b] [font-size:0.8rem] [margin-bottom:0.75rem] flex items-center [gap:0.4rem]">
              <AlertIcon /> {vError}
            </div>
          )}

          <div className="overflow-x-auto [border:1px_solid_var(--line,_#e5e7eb)] [border-radius:8px]">
            <table className="[width:100%] border-collapse [font-size:0.8rem]">
              <thead>
                <tr className="[background:var(--surface-soft,_#f9fafb)] text-left">
                  <th className="[padding:0.5rem_0.6rem] [font-weight:600] whitespace-nowrap">Product</th>
                  <th className="[padding:0.5rem_0.6rem] [font-weight:600] whitespace-nowrap">SKU</th>
                  <th className="[padding:0.5rem_0.6rem] [font-weight:600] whitespace-nowrap">Size/Color</th>
                  <th className="[padding:0.5rem_0.6rem] [font-weight:600] whitespace-nowrap text-right">On Hand</th>
                  <th className="[padding:0.5rem_0.6rem] [font-weight:600] whitespace-nowrap text-right">Reserved</th>
                  <th className="[padding:0.5rem_0.6rem] [font-weight:600] whitespace-nowrap text-right">Available</th>
                  <th className="[padding:0.5rem_0.6rem] [font-weight:600] whitespace-nowrap text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {vLoading ? (
                  <tr><td colSpan={7} className="[padding:2rem] text-center [color:var(--muted,_#6b7280)]">Loading...</td></tr>
                ) : variants.length === 0 ? (
                  <tr><td colSpan={7} className="[padding:2rem] text-center [color:var(--muted,_#6b7280)]">No variants found.</td></tr>
                ) : variants.map(v => (
                  <tr key={v.id} className="[border-top:1px_solid_var(--line-soft,_#f3f4f6)]">
                    <td className="[padding:0.5rem_0.6rem] [font-weight:500] [color:var(--brand,_#6366f1)]">{v.productName}</td>
                    <td className="[padding:0.5rem_0.6rem] font-mono [font-size:0.75rem]">{v.sku}</td>
                    <td className="[padding:0.5rem_0.6rem] [color:var(--muted,_#6b7280)]">{[v.size, v.color].filter(Boolean).join(' / ') || '—'}</td>
                    <td className={`[padding:0.5rem_0.6rem] text-right [font-weight:600] ${v.quantity === 0 ? '[color:#dc2626]' : '[color:#92400e]'}`}>{v.quantity}</td>
                    <td className="[padding:0.5rem_0.6rem] text-right [color:var(--muted,_#6b7280)]">{v.reserved}</td>
                    <td className={`[padding:0.5rem_0.6rem] text-right [font-weight:600] ${v.available <= 0 ? '[color:#dc2626]' : v.available <= 5 ? '[color:#f59e0b]' : '[color:#16a34a]'}`}>{v.available}</td>
                    <td className="[padding:0.5rem_0.6rem] text-right">
                      <button onClick={() => openAdjust(v)}
                        className="[padding:0.3rem_0.7rem] [font-size:0.75rem] [font-weight:600] cursor-pointer [border:1px_solid_var(--brand,_#6366f1)] [border-radius:5px] [background:var(--brand,_#6366f1)] [color:#fff]">
                        Adjust
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {vTotalPages > 1 && (
            <div className="flex justify-center [gap:0.25rem] [margin-top:0.75rem] items-center [font-size:0.8rem]">
              <button disabled={vPage <= 1} onClick={() => fetchVariants(vPage - 1)}
                className={`[padding:0.3rem_0.6rem] [border:1px_solid_var(--line,_#d1d5db)] [border-radius:4px] ${vPage > 1 ? '[cursor:pointer] [background:#fff] [opacity:1]' : '[cursor:default] [background:#f3f4f6] [opacity:0.5]'}`}>
                Prev
              </button>
              <span className="[color:var(--muted,_#6b7280)]">Page {vPage} of {vTotalPages} ({vTotal} variants)</span>
              <button disabled={vPage >= vTotalPages} onClick={() => fetchVariants(vPage + 1)}
                className={`[padding:0.3rem_0.6rem] [border:1px_solid_var(--line,_#d1d5db)] [border-radius:4px] ${vPage < vTotalPages ? '[cursor:pointer] [background:#fff] [opacity:1]' : '[cursor:default] [background:#f3f4f6] [opacity:0.5]'}`}>
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {/* ───── MOVEMENT LOG TAB ───── */}
      {tab === 'movements' && (
        <div>
          <div className="flex [gap:0.5rem] [margin-bottom:0.75rem] flex-wrap items-center">
            <input type="text" placeholder="Filter by variant ID..." value={mFilterVariant}
              onChange={e => setMFilterVariant(e.target.value)}
              className="[padding:0.4rem_0.6rem] [font-size:0.8rem] [border:1px_solid_var(--line,_#d1d5db)] [border-radius:6px] [outline:none] [width:180px]" />
            <select value={mFilterReason} onChange={e => setMFilterReason(e.target.value)}
              className="[padding:0.4rem_0.6rem] [font-size:0.8rem] [border:1px_solid_var(--line,_#d1d5db)] [border-radius:6px] [outline:none] [background:#fff]">
              <option value="">All reasons</option>
              {ADJUSTMENT_REASONS.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            <button onClick={() => fetchMovements(1)}
              className="[padding:0.4rem_0.8rem] [font-size:0.8rem] [font-weight:600] cursor-pointer [border:1px_solid_var(--brand,_#6366f1)] [border-radius:6px] [background:var(--brand,_#6366f1)] [color:#fff]">
              Filter
            </button>
          </div>

          {mError && (
            <div className="[padding:0.5rem_0.75rem] [background:#fef2f2] [border:1px_solid_#fecaca] [border-radius:6px] [color:#991b1b] [font-size:0.8rem] [margin-bottom:0.75rem] flex items-center [gap:0.4rem]">
              <AlertIcon /> {mError}
            </div>
          )}

          <div className="overflow-x-auto [border:1px_solid_var(--line,_#e5e7eb)] [border-radius:8px]">
            <table className="[width:100%] border-collapse [font-size:0.8rem]">
              <thead>
                <tr className="[background:var(--surface-soft,_#f9fafb)] text-left">
                  <th className="[padding:0.5rem_0.6rem] [font-weight:600] whitespace-nowrap">Type</th>
                  <th className="[padding:0.5rem_0.6rem] [font-weight:600] whitespace-nowrap">Product / SKU</th>
                  <th className="[padding:0.5rem_0.6rem] [font-weight:600] whitespace-nowrap">Reason</th>
                  <th className="[padding:0.5rem_0.6rem] [font-weight:600] whitespace-nowrap">Notes</th>
                  <th className="[padding:0.5rem_0.6rem] [font-weight:600] whitespace-nowrap text-right">Change</th>
                  <th className="[padding:0.5rem_0.6rem] [font-weight:600] whitespace-nowrap text-right">By</th>
                  <th className="[padding:0.5rem_0.6rem] [font-weight:600] whitespace-nowrap text-right">Time</th>
                </tr>
              </thead>
              <tbody>
                {mLoading ? (
                  <tr><td colSpan={7} className="[padding:2rem] text-center [color:var(--muted,_#6b7280)]">Loading...</td></tr>
                ) : movements.length === 0 ? (
                  <tr><td colSpan={7} className="[padding:2rem] text-center [color:var(--muted,_#6b7280)]">No movements recorded yet.</td></tr>
                ) : movements.map(m => (
                  <tr key={m.id} className="[border-top:1px_solid_var(--line-soft,_#f3f4f6)]">
                    <td className="[padding:0.5rem_0.6rem]">
                      <span className={`inline-block [padding:1px_6px] [border-radius:4px] [font-size:0.7rem] [font-weight:600] whitespace-nowrap ${m.delta > 0 ? '[background:#dcfce7] [color:#166534]' : '[background:#fee2e2] [color:#991b1b]'}`}>
                        {m.delta > 0 ? 'Addition' : 'Removal'}
                      </span>
                    </td>
                    <td className="[padding:0.5rem_0.6rem]">
                      <div className="[font-weight:500]">{m.productName}</div>
                      <div className="font-mono [font-size:0.7rem] [color:var(--muted,_#6b7280)]">{m.sku}</div>
                    </td>
                    <td className="[padding:0.5rem_0.6rem] whitespace-nowrap">
                      <span className="[font-size:0.7rem] [color:var(--muted,_#6b7280)]">{reasonLabel(m.reason)}</span>
                    </td>
                    <td className="[padding:0.5rem_0.6rem] [color:var(--muted,_#6b7280)] [font-size:0.75rem] [max-width:150px] overflow-hidden text-ellipsis whitespace-nowrap">
                      {m.notes || '—'}
                    </td>
                    <td className="[padding:0.5rem_0.6rem] text-right">
                      <div className={`[font-weight:700] [font-size:0.85rem] ${m.delta > 0 ? '[color:#16a34a]' : '[color:#dc2626]'}`}>
                        {m.delta > 0 ? '+' : ''}{m.delta}
                      </div>
                      {(m.prevQuantity != null && m.newQuantity != null) && (
                        <div className="[font-size:0.65rem] [color:var(--muted,_#6b7280)]">
                          {m.prevQuantity} → {m.newQuantity}
                        </div>
                      )}
                    </td>
                    <td className="[padding:0.5rem_0.6rem] text-right [font-size:0.75rem] [color:var(--muted,_#6b7280)]">
                      {m.adjustedByName || shortId(m.adjustedBy) || '—'}
                    </td>
                    <td className="[padding:0.5rem_0.6rem] text-right [font-size:0.7rem] [color:var(--muted,_#6b7280)] whitespace-nowrap">
                      <span title={formatDate(m.createdAt)}>{timeAgo(m.createdAt)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {mTotalPages > 1 && (
            <div className="flex justify-center [gap:0.25rem] [margin-top:0.75rem] items-center [font-size:0.8rem]">
              <button disabled={mPage <= 1} onClick={() => fetchMovements(mPage - 1)}
                className={`[padding:0.3rem_0.6rem] [border:1px_solid_var(--line,_#d1d5db)] [border-radius:4px] ${mPage > 1 ? '[cursor:pointer] [background:#fff] [opacity:1]' : '[cursor:default] [background:#f3f4f6] [opacity:0.5]'}`}>
                Prev
              </button>
              <span className="[color:var(--muted,_#6b7280)]">Page {mPage} of {mTotalPages} ({mTotal} entries)</span>
              <button disabled={mPage >= mTotalPages} onClick={() => fetchMovements(mPage + 1)}
                className={`[padding:0.3rem_0.6rem] [border:1px_solid_var(--line,_#d1d5db)] [border-radius:4px] ${mPage < mTotalPages ? '[cursor:pointer] [background:#fff] [opacity:1]' : '[cursor:default] [background:#f3f4f6] [opacity:0.5]'}`}>
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {/* ───── ADJUSTMENT DIALOG ───── */}
      {adjustTarget && !adjSuccess && (
        <div className="fixed inset-0 [background:rgba(0,0,0,0.4)] flex items-center justify-center [z-index:1000]"
          onClick={e => e.target === e.currentTarget && !adjSubmitting && closeAdjust()}>
          <div className="[background:#fff] [border-radius:12px] [width:420px] [max-width:94vw] [max-height:90vh] [overflow:auto] [box-shadow:0_20px_60px_rgba(0,0,0,0.2)]">
            <div className="[padding:1rem_1.25rem] [border-bottom:1px_solid_#e5e7eb] flex justify-between items-center">
              <div>
                <h3 className="[margin:0] [font-size:1rem] [font-weight:700]">
                  {confirmStep ? 'Confirm Adjustment' : 'Adjust Stock'}
                </h3>
                <p className="[margin:0.15rem_0_0] [font-size:0.78rem] [color:var(--muted,_#6b7280)]">
                  {adjustTarget.productName}
                  <span className="font-mono [margin-left:0.4rem]">{adjustTarget.sku}</span>
                </p>
              </div>
              <button onClick={closeAdjust} disabled={adjSubmitting}
                className={`[padding:0.3rem] cursor-pointer [border:none] [background:none] [color:#9ca3af] ${adjSubmitting ? '[opacity:0.5]' : '[opacity:1]'}`}>
                <XIcon />
              </button>
            </div>

            <div className="[padding:1rem_1.25rem]">
              {!confirmStep ? (
                <div className="flex flex-col [gap:1rem]">
                  {/* Current stock cards */}
                  <div className="grid [grid-template-columns:1fr_1fr_1fr] [gap:0.5rem]">
                    {[
                      { label: 'On Hand', value: adjustTarget.quantity, colorClass: '[color:#92400e]' },
                      { label: 'Reserved', value: adjustTarget.reserved, colorClass: '[color:var(--muted,_#6b7280)]' },
                      { label: 'Available', value: adjustTarget.available, colorClass: adjustTarget.available <= 0 ? '[color:#dc2626]' : '[color:#16a34a]' },
                    ].map(c => (
                      <div key={c.label} className="text-center [padding:0.5rem] [background:#f9fafb] [border-radius:6px] [border:1px_solid_#f3f4f6]">
                        <div className="[font-size:0.65rem] uppercase [letter-spacing:0.05em] [color:var(--muted,_#6b7280)]">{c.label}</div>
                        <div className={`[font-size:1rem] [font-weight:700] [margin-top:0.15rem] ${c.colorClass}`}>{c.value}</div>
                      </div>
                    ))}
                  </div>

                  {/* Delta input with +/- buttons */}
                  <div>
                    <label className="[font-size:0.78rem] [font-weight:600] [margin-bottom:0.3rem] block">Adjustment Amount</label>
                    <div className="flex items-center [gap:0.5rem]">
                      <button onClick={() => setDelta(d => d - 1)}
                        className="[padding:0.4rem] cursor-pointer [border:1px_solid_#d1d5db] [border-radius:6px] [background:#fff] flex items-center justify-center [width:36px] [height:36px]">
                        <MinusIcon />
                      </button>
                      <input type="number" value={delta}
                        onChange={e => { const v = parseInt(e.target.value); setDelta(Number.isFinite(v) ? v : 0); }}
                        className="flex-1 text-center [font-weight:700] [font-size:1rem] [padding:0.4rem] [border:1px_solid_#d1d5db] [border-radius:6px] [outline:none] [height:36px] box-border [-moz-appearance:textfield]" />
                      <button onClick={() => setDelta(d => d + 1)}
                        className="[padding:0.4rem] cursor-pointer [border:1px_solid_#d1d5db] [border-radius:6px] [background:#fff] flex items-center justify-center [width:36px] [height:36px]">
                        <PlusIcon />
                      </button>
                    </div>
                    {delta !== 0 && (
                      <div className="[margin-top:0.4rem] text-center [font-size:0.78rem] [color:var(--muted,_#6b7280)]">
                        New on hand: <b>{adjustTarget.quantity + delta}</b>
                        &nbsp;→&nbsp; New available: <b className={(adjustTarget.available + delta) <= 0 ? '[color:#dc2626]' : '[color:#16a34a]'}>
                          {Math.max(0, adjustTarget.available + delta)}
                        </b>
                      </div>
                    )}
                  </div>

                  {/* Reason dropdown */}
                  <div>
                    <label className="[font-size:0.78rem] [font-weight:600] [margin-bottom:0.3rem] block">Reason</label>
                    <select value={adjReason} onChange={e => { setAdjReason(e.target.value); setDelta(0); }}
                      className="[width:100%] [padding:0.4rem_0.6rem] [font-size:0.8rem] [border:1px_solid_#d1d5db] [border-radius:6px] [outline:none] [background:#fff]">
                      {ADJUSTMENT_REASONS.map(r => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                    {selectedReason && (
                      <p className="[margin:0.3rem_0_0] [font-size:0.72rem] [color:var(--muted,_#6b7280)]">{selectedReason.description}</p>
                    )}
                  </div>

                  {/* Notes */}
                  <div>
                    <label className="[font-size:0.78rem] [font-weight:600] [margin-bottom:0.3rem] block">Notes <span className="[font-weight:400] [color:var(--muted,_#6b7280)]">(optional)</span></label>
                    <textarea value={adjNotes} onChange={e => setAdjNotes(e.target.value)} maxLength={1000} rows={2}
                      placeholder="Add context for audit trail..."
                      className="[width:100%] [padding:0.4rem_0.6rem] [font-size:0.8rem] [border:1px_solid_#d1d5db] [border-radius:6px] [outline:none] resize-y [font-family:inherit]" />
                  </div>
                </div>
              ) : (
                /* Confirmation step */
                <div>
                  <div className="[background:#fffbeb] [border:1px_solid_#fde68a] [border-radius:8px] [padding:0.75rem_1rem] [margin-bottom:1rem] [font-size:0.8rem] flex [gap:0.4rem] items-start">
                    <AlertIcon />
                    <div>
                      <strong>Confirm stock change</strong><br />
                      This action is irreversible and will be recorded in the audit trail.
                    </div>
                  </div>
                  <table className="[width:100%] [font-size:0.8rem] border-collapse">
                    <tbody>
                      <tr><td className="[padding:0.4rem_0] [color:var(--muted,_#6b7280)]">Product</td><td className="[padding:0.4rem_0] text-right [font-weight:500]">{adjustTarget.productName}</td></tr>
                      <tr><td className="[padding:0.4rem_0] [color:var(--muted,_#6b7280)]">SKU</td><td className="[padding:0.4rem_0] text-right font-mono">{adjustTarget.sku}</td></tr>
                      <tr><td className="[padding:0.4rem_0] [color:var(--muted,_#6b7280)]">Change</td><td className={`[padding:0.4rem_0] text-right [font-weight:700] ${delta > 0 ? '[color:#16a34a]' : '[color:#dc2626]'}`}>{delta > 0 ? '+' : ''}{delta}</td></tr>
                      <tr><td className="[padding:0.4rem_0] [color:var(--muted,_#6b7280)]">Current Stock</td><td className="[padding:0.4rem_0] text-right">{adjustTarget.quantity}</td></tr>
                      <tr><td className="[padding:0.4rem_0] [color:var(--muted,_#6b7280)]">New Stock</td><td className="[padding:0.4rem_0] text-right [font-weight:700]">{adjustTarget.quantity + delta}</td></tr>
                      <tr><td className="[padding:0.4rem_0] [color:var(--muted,_#6b7280)]">Reason</td><td className="[padding:0.4rem_0] text-right">{selectedReason?.label || adjReason}</td></tr>
                      {adjNotes && <tr><td className="[padding:0.4rem_0] [color:var(--muted,_#6b7280)]">Notes</td><td className="[padding:0.4rem_0] text-right [max-width:200px] overflow-hidden text-ellipsis whitespace-nowrap">{adjNotes}</td></tr>}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {adjError && (
              <div className="[margin:0_1.25rem_0.75rem] [padding:0.5rem_0.75rem] [background:#fef2f2] [border:1px_solid_#fecaca] [border-radius:6px] [color:#991b1b] [font-size:0.78rem]">
                {adjError}
              </div>
            )}

            <div className="[padding:0.75rem_1.25rem] [border-top:1px_solid_#e5e7eb] flex justify-end [gap:0.5rem]">
              <button onClick={closeAdjust} disabled={adjSubmitting}
                className={`[padding:0.45rem_0.9rem] [font-size:0.8rem] cursor-pointer [border:1px_solid_#d1d5db] [border-radius:6px] [background:#fff] [font-weight:500] ${adjSubmitting ? '[opacity:0.5]' : '[opacity:1]'}`}>
                Cancel
              </button>
              {!confirmStep ? (
                <button onClick={() => { if (delta === 0) { setAdjError('Adjustment amount cannot be zero'); return; } setConfirmStep(true); setAdjError(''); }}
                  disabled={delta === 0}
                  className={`[padding:0.45rem_0.9rem] [font-size:0.8rem] [border:none] [border-radius:6px] [font-weight:600] ${delta !== 0 ? '[cursor:pointer] [background:var(--brand,_#6366f1)] [color:#fff]' : '[cursor:default] [background:#d1d5db] [color:#9ca3af]'}`}>
                  Continue
                </button>
              ) : (
                <button onClick={submitAdjust} disabled={adjSubmitting}
                  className={`[padding:0.45rem_0.9rem] [font-size:0.8rem] [border:none] [border-radius:6px] [color:#fff] [font-weight:600] ${adjSubmitting ? '[cursor:default] [background:#9ca3af] [opacity:0.7]' : `[cursor:pointer] [opacity:1] ${delta > 0 ? '[background:#16a34a]' : '[background:#dc2626]'}`}`}>
                  {adjSubmitting ? 'Applying...' : `Confirm ${delta > 0 ? '+' : ''}${delta}`}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Success confirmation */}
      {adjSuccess && (
        <div className="fixed inset-0 [background:rgba(0,0,0,0.4)] flex items-center justify-center [z-index:1000]"
          onClick={e => e.target === e.currentTarget && (closeAdjust())}>
          <div className="[background:#fff] [border-radius:12px] [width:380px] [max-width:90vw] [padding:1.5rem] text-center [box-shadow:0_20px_60px_rgba(0,0,0,0.2)]">
            <div className="[width:48px] [height:48px] [border-radius:50%] [background:#dcfce7] flex items-center justify-center [margin:0_auto_0.75rem]">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2"><path d="M20 6 9 17l-5-5"/></svg>
            </div>
            <h3 className="[margin:0_0_0.25rem] [font-size:1rem] [font-weight:700]">Stock Adjusted</h3>
            <p className="[margin:0] [font-size:0.85rem] [color:var(--muted,_#6b7280)]">
              {adjSuccess.previousStock} → {adjSuccess.newStock} ({adjSuccess.delta > 0 ? '+' : ''}{adjSuccess.delta})
            </p>
            <button onClick={closeAdjust}
              className="[margin-top:1rem] [padding:0.5rem_1.5rem] [font-size:0.85rem] cursor-pointer [border:none] [border-radius:6px] [background:var(--brand,_#6366f1)] [color:#fff] [font-weight:600]">
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
