import { useState, useEffect, useCallback } from 'react';
import type { Category, VariantInput, CreateProductResult } from '../../types/product';

interface FormData {
  name: string;
  description: string;
  slug: string;
  categoryId: string;
  pricePaisa: string;
  comparePricePaisa: string;
  status: 'draft' | 'published';
  isFeatured: boolean;
  metaTitle: string;
  metaDescription: string;
}

function getCsrf(): string {
  if (typeof window.__ZB_CSRF__ === 'string' && window.__ZB_CSRF__) return window.__ZB_CSRF__;
  try { return sessionStorage.getItem('zb-csrf') || ''; } catch { return ''; }
}

function slugify(name: string): string {
  return name.toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200) || '';
}

function XIcon() { return <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>; }
function AlertIcon() { return <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4M12 17h.01"/><path d="M3.09 21h17.82a1 1 0 0 0 .86-1.5L13.13 3.4a1 1 0 0 0-1.74 0L2.23 19.5a1 1 0 0 0 .86 1.5z"/></svg>; }
function CheckIcon() { return <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6 9 17l-5-5"/></svg>; }
function PlusIcon() { return <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5v14"/></svg>; }
function TrashIcon() { return <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>; }

let slugManuallyEdited = false;

export default function ProductForm() {
  const [form, setForm] = useState<FormData>({
    name: '', description: '', slug: '', categoryId: '',
    pricePaisa: '', comparePricePaisa: '', status: 'draft',
    isFeatured: false, metaTitle: '', metaDescription: '',
  });
  const [categories, setCategories] = useState<Category[]>([]);
  const [variants, setVariants] = useState<VariantInput[]>([
    { sku: '', size: '', color: '', pricePaisa: null, stock: 0 },
  ]);
  const [step, setStep] = useState<'form' | 'review'>('form');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<CreateProductResult | null>(null);

  useEffect(() => {
    fetch('/api/staff/products/categories', { headers: { 'X-CSRF-Token': getCsrf() } })
      .then(r => r.json() as Promise<{ ok: boolean; categories: Category[] }>)
      .then(d => { if (d.ok) setCategories(d.categories); })
      .catch(() => {});
  }, []);

  function setField<K extends keyof FormData>(key: K, value: FormData[K]) {
    setForm(prev => {
      const next = { ...prev, [key]: value };
      if (key === 'name' && !slugManuallyEdited) {
        next.slug = slugify(value as string);
      }
      return next;
    });
  }

  function updateVariant(i: number, field: keyof VariantInput, value: string | number | null) {
    setVariants(prev => {
      const next = [...prev];
      next[i] = { ...next[i], [field]: value as never };
      return next;
    });
  }

  function addVariant() {
    setVariants(prev => [...prev, { sku: '', size: '', color: '', pricePaisa: null, stock: 0 }]);
  }

  function removeVariant(i: number) {
    setVariants(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev);
  }

  function autoFillSku(i: number) {
    const slug = form.slug || slugify(form.name);
    const v = variants[i];
    const parts = [slug.toUpperCase().replace(/-/g, '_'), v.size?.toUpperCase(), v.color?.toUpperCase()].filter(Boolean);
    updateVariant(i, 'sku', parts.join('_'));
  }

  function validate(): string | null {
    if (!form.name.trim()) return 'Product name is required';
    if (!form.pricePaisa || parseInt(form.pricePaisa) < 0) return 'Valid price is required';
    const vSkus = variants.map(v => v.sku.trim().toUpperCase());
    const unique = new Set(vSkus);
    if (unique.size !== vSkus.length) return 'Duplicate SKUs found';
    for (let i = 0; i < variants.length; i++) {
      if (!variants[i].sku.trim()) return `Variant ${i + 1}: SKU is required`;
    }
    return null;
  }

  async function submit() {
    const err = validate();
    if (err) { setError(err); return; }
    setSubmitting(true);
    setError('');
    try {
      const res = await fetch('/api/staff/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrf() },
        body: JSON.stringify({
          name: form.name.trim(),
          description: form.description.trim() || null,
          slug: form.slug.trim() || null,
          categoryId: form.categoryId || null,
          pricePaisa: parseInt(form.pricePaisa),
          comparePricePaisa: form.comparePricePaisa ? parseInt(form.comparePricePaisa) : null,
          status: form.status,
          isFeatured: form.isFeatured,
          metaTitle: form.metaTitle.trim() || null,
          metaDescription: form.metaDescription.trim() || null,
          variants: variants.map(v => ({
            sku: v.sku.trim().toUpperCase(),
            size: v.size?.trim() || null,
            color: v.color?.trim() || null,
            pricePaisa: v.pricePaisa != null && v.pricePaisa > 0 ? v.pricePaisa : null,
            stock: v.stock,
          })),
        }),
      });
      const data: { ok: boolean; productId?: string; variantIds?: string[]; error?: string } = await res.json();
      if (data.ok && data.productId && data.variantIds) {
        setResult({ ok: true, productId: data.productId, variantIds: data.variantIds });
      } else {
        setError(data.error || 'Failed to create product');
      }
    } catch { setError('Network error'); }
    finally { setSubmitting(false); }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '0.45rem 0.6rem', fontSize: '0.82rem',
    border: '1px solid #d1d5db', borderRadius: '6px', outline: 'none',
    boxSizing: 'border-box', fontFamily: 'inherit',
  };
  const labelStyle: React.CSSProperties = {
    fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.3rem', display: 'block',
  };
  const sectionHead: React.CSSProperties = {
    fontSize: '0.9rem', fontWeight: 700, margin: '1.25rem 0 0.75rem', paddingBottom: '0.4rem',
    borderBottom: '1px solid #e5e7eb',
  };

  if (result) {
    return (
      <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: '520px', margin: '2rem auto', textAlign: 'center' }}>
        <div style={{ width: '56px', height: '56px', borderRadius: '50%', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
          <CheckIcon />
        </div>
        <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.15rem', fontWeight: 700 }}>Product Created</h2>
        <p style={{ fontSize: '0.85rem', color: '#6b7280', margin: '0 0 1rem' }}>
          {form.name} &mdash; {variants.length} variant{variants.length > 1 ? 's' : ''}
        </p>
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <a href={`/staff/products/${form.slug || result.productId}/edit`}
            style={{ padding: '0.5rem 1.2rem', fontSize: '0.85rem', fontWeight: 600, borderRadius: '6px', background: '#6366f1', color: '#fff', textDecoration: 'none' }}>
            Edit Product
          </a>
          <button onClick={() => window.location.reload()}
            style={{ padding: '0.5rem 1.2rem', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', border: '1px solid #d1d5db', borderRadius: '6px', background: '#fff' }}>
            Create Another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: '860px' }}>
      {error && (
        <div style={{ padding: '0.6rem 0.85rem', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '6px', color: '#991b1b', fontSize: '0.8rem', marginBottom: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <AlertIcon /> {error}
        </div>
      )}

      {step === 'form' ? (
        <div>
          {/* ───── BASIC INFO ───── */}
          <div style={sectionHead}>Basic Information</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Product Name *</label>
              <input type="text" value={form.name} onChange={e => setField('name', e.target.value)} maxLength={500}
                placeholder="e.g. Summer Floral Kurti" style={inputStyle} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Slug</label>
              <input type="text" value={form.slug} onChange={e => { slugManuallyEdited = true; setField('slug', e.target.value); }}
                maxLength={200} placeholder="auto-generated from name" style={{ ...inputStyle, color: '#6b7280', fontFamily: 'monospace', fontSize: '0.78rem' }} />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Description</label>
              <textarea value={form.description} onChange={e => setField('description', e.target.value)} maxLength={10000} rows={4}
                placeholder="Product description..." style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
              <span style={{ fontSize: '0.7rem', color: '#9ca3af' }}>{form.description.length}/10000</span>
            </div>
            <div>
              <label style={labelStyle}>Category</label>
              <select value={form.categoryId} onChange={e => setField('categoryId', e.target.value)} style={inputStyle}>
                <option value="">No category</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={labelStyle}>Status</label>
              <select value={form.status} onChange={e => setField('status', e.target.value as 'draft' | 'published')} style={inputStyle}>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
              </select>
            </div>
          </div>

          {/* ───── PRICING ───── */}
          <div style={sectionHead}>Pricing</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div>
              <label style={labelStyle}>Price (paisa) *</label>
              <input type="number" min="0" value={form.pricePaisa} onChange={e => setField('pricePaisa', e.target.value)}
                placeholder="e.g. 299900" style={inputStyle} />
              <span style={{ fontSize: '0.7rem', color: '#9ca3af' }}>
                {form.pricePaisa ? `৳ ${(parseInt(form.pricePaisa) / 100).toFixed(2)}` : ''}
              </span>
            </div>
            <div>
              <label style={labelStyle}>Compare Price (paisa)</label>
              <input type="number" min="0" value={form.comparePricePaisa} onChange={e => setField('comparePricePaisa', e.target.value)}
                placeholder="e.g. 399900" style={inputStyle} />
              <span style={{ fontSize: '0.7rem', color: '#9ca3af' }}>
                {form.comparePricePaisa ? `৳ ${(parseInt(form.comparePricePaisa) / 100).toFixed(2)}` : ''}
              </span>
            </div>
            <div>
              <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <input type="checkbox" checked={form.isFeatured} onChange={e => setField('isFeatured', e.target.checked)} />
                Featured product
              </label>
            </div>
          </div>

          {/* ───── SEO ───── */}
          <div style={sectionHead}>SEO</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Meta Title</label>
              <input type="text" value={form.metaTitle} onChange={e => setField('metaTitle', e.target.value)} maxLength={500}
                placeholder="SEO title (leave blank to use product name)" style={inputStyle} />
              <span style={{ fontSize: '0.7rem', color: '#9ca3af' }}>{form.metaTitle.length}/500</span>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label style={labelStyle}>Meta Description</label>
              <textarea value={form.metaDescription} onChange={e => setField('metaDescription', e.target.value)} maxLength={1000} rows={2}
                placeholder="SEO description..." style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
              <span style={{ fontSize: '0.7rem', color: '#9ca3af' }}>{form.metaDescription.length}/1000</span>
            </div>
          </div>

          {/* ───── VARIANTS ───── */}
          <div style={{ ...sectionHead, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Variants ({variants.length})</span>
            <button onClick={addVariant}
              style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', padding: '0.35rem 0.7rem', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', border: '1px solid #6366f1', borderRadius: '6px', background: '#6366f1', color: '#fff' }}>
              <PlusIcon /> Add Variant
            </button>
          </div>

          <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: '8px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
                  <th style={{ padding: '0.45rem 0.5rem', fontWeight: 600, whiteSpace: 'nowrap' }}>SKU *</th>
                  <th style={{ padding: '0.45rem 0.5rem', fontWeight: 600, whiteSpace: 'nowrap' }}>Size</th>
                  <th style={{ padding: '0.45rem 0.5rem', fontWeight: 600, whiteSpace: 'nowrap' }}>Color</th>
                  <th style={{ padding: '0.45rem 0.5rem', fontWeight: 600, whiteSpace: 'nowrap' }}>Price (paisa)</th>
                  <th style={{ padding: '0.45rem 0.5rem', fontWeight: 600, whiteSpace: 'nowrap' }}>Stock</th>
                  <th style={{ padding: '0.45rem 0.5rem', fontWeight: 600, whiteSpace: 'nowrap' }}></th>
                </tr>
              </thead>
              <tbody>
                {variants.map((v, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '0.35rem 0.4rem' }}>
                      <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                        <input type="text" value={v.sku} onChange={e => updateVariant(i, 'sku', e.target.value.toUpperCase())}
                          maxLength={100}
                          style={{ width: '110px', padding: '0.3rem 0.4rem', fontSize: '0.75rem', border: '1px solid #d1d5db', borderRadius: '4px', fontFamily: 'monospace', outline: 'none' }} />
                        <button onClick={() => autoFillSku(i)} title="Auto-fill SKU from slug+size+color"
                          style={{ padding: '0.2rem', cursor: 'pointer', border: 'none', background: 'none', color: '#6366f1', fontSize: '0.7rem' }}>
                          ↻
                        </button>
                      </div>
                    </td>
                    <td style={{ padding: '0.35rem 0.4rem' }}>
                      <input type="text" value={v.size ?? ''} onChange={e => updateVariant(i, 'size', e.target.value)} maxLength={50}
                        placeholder="e.g. M" style={{ width: '60px', padding: '0.3rem 0.4rem', fontSize: '0.75rem', border: '1px solid #d1d5db', borderRadius: '4px', outline: 'none' }} />
                    </td>
                    <td style={{ padding: '0.35rem 0.4rem' }}>
                      <input type="text" value={v.color ?? ''} onChange={e => updateVariant(i, 'color', e.target.value)} maxLength={50}
                        placeholder="e.g. Red" style={{ width: '72px', padding: '0.3rem 0.4rem', fontSize: '0.75rem', border: '1px solid #d1d5db', borderRadius: '4px', outline: 'none' }} />
                    </td>
                    <td style={{ padding: '0.35rem 0.4rem' }}>
                      <input type="number" min="0" value={v.pricePaisa ?? ''} onChange={e => updateVariant(i, 'pricePaisa', e.target.value ? parseInt(e.target.value) : null)}
                        placeholder={form.pricePaisa || '0'}
                        style={{ width: '90px', padding: '0.3rem 0.4rem', fontSize: '0.75rem', border: '1px solid #d1d5db', borderRadius: '4px', outline: 'none' }} />
                    </td>
                    <td style={{ padding: '0.35rem 0.4rem' }}>
                      <input type="number" min="0" value={v.stock} onChange={e => updateVariant(i, 'stock', parseInt(e.target.value) || 0)}
                        style={{ width: '60px', padding: '0.3rem 0.4rem', fontSize: '0.75rem', border: '1px solid #d1d5db', borderRadius: '4px', outline: 'none' }} />
                    </td>
                    <td style={{ padding: '0.35rem 0.4rem' }}>
                      <button onClick={() => removeVariant(i)} disabled={variants.length <= 1}
                        style={{ padding: '0.25rem', cursor: variants.length > 1 ? 'pointer' : 'default', border: 'none', background: 'none', color: variants.length > 1 ? '#ef4444' : '#d1d5db', opacity: variants.length > 1 ? 1 : 0.4 }}>
                        <TrashIcon />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ───── ACTIONS ───── */}
          <div style={{ marginTop: '1.25rem', paddingTop: '0.75rem', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <button onClick={() => { setError(''); setStep('review'); }}
              style={{ padding: '0.55rem 1.2rem', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', border: 'none', borderRadius: '6px', background: '#6366f1', color: '#fff' }}>
              Review &amp; Confirm
            </button>
          </div>
        </div>
      ) : (
        /* ───── REVIEW & CONFIRM ───── */
        <div>
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '0.75rem 1rem', marginBottom: '1rem', fontSize: '0.8rem', display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}>
            <AlertIcon />
            <div>
              <strong>Review before creating</strong><br />
              This will create the product, {variants.length} variant{variants.length > 1 ? 's' : ''}, and initialize inventory. Audit-logged.
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', fontSize: '0.82rem' }}>
            <div><span style={{ color: '#6b7280' }}>Name</span><br /><strong>{form.name}</strong></div>
            <div><span style={{ color: '#6b7280' }}>Slug</span><br /><span style={{ fontFamily: 'monospace' }}>{form.slug || '(auto)'}</span></div>
            {form.description && <div style={{ gridColumn: '1 / -1' }}><span style={{ color: '#6b7280' }}>Description</span><br />{form.description}</div>}
            <div><span style={{ color: '#6b7280' }}>Category</span><br />{categories.find(c => c.id === form.categoryId)?.name || 'None'}</div>
            <div><span style={{ color: '#6b7280' }}>Status</span><br />{form.status === 'published' ? 'Published' : 'Draft'}</div>
            <div><span style={{ color: '#6b7280' }}>Price</span><br />৳ {(parseInt(form.pricePaisa) / 100).toFixed(2)}</div>
            <div><span style={{ color: '#6b7280' }}>Compare Price</span><br />{form.comparePricePaisa ? `৳ ${(parseInt(form.comparePricePaisa) / 100).toFixed(2)}` : 'None'}</div>
            <div><span style={{ color: '#6b7280' }}>Featured</span><br />{form.isFeatured ? 'Yes' : 'No'}</div>
            {form.metaTitle && <div><span style={{ color: '#6b7280' }}>Meta Title</span><br />{form.metaTitle}</div>}
            {form.metaDescription && <div><span style={{ color: '#6b7280' }}>Meta Description</span><br />{form.metaDescription}</div>}
          </div>

          <div style={{ ...sectionHead, marginTop: '1rem' }}>Variants ({variants.length})</div>
          <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '0.8rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f9fafb', textAlign: 'left' }}>
                  <th style={{ padding: '0.4rem 0.5rem', fontWeight: 600 }}>SKU</th>
                  <th style={{ padding: '0.4rem 0.5rem', fontWeight: 600 }}>Size</th>
                  <th style={{ padding: '0.4rem 0.5rem', fontWeight: 600 }}>Color</th>
                  <th style={{ padding: '0.4rem 0.5rem', fontWeight: 600, textAlign: 'right' }}>Price</th>
                  <th style={{ padding: '0.4rem 0.5rem', fontWeight: 600, textAlign: 'right' }}>Stock</th>
                </tr>
              </thead>
              <tbody>
                {variants.map((v, i) => (
                  <tr key={i} style={{ borderTop: '1px solid #f3f4f6' }}>
                    <td style={{ padding: '0.4rem 0.5rem', fontFamily: 'monospace' }}>{v.sku || '—'}</td>
                    <td style={{ padding: '0.4rem 0.5rem' }}>{v.size || '—'}</td>
                    <td style={{ padding: '0.4rem 0.5rem' }}>{v.color || '—'}</td>
                    <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>
                      {v.pricePaisa != null ? `৳ ${(v.pricePaisa / 100).toFixed(2)}` : 'Default'}
                    </td>
                    <td style={{ padding: '0.4rem 0.5rem', textAlign: 'right' }}>{v.stock}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Actions */}
          <div style={{ marginTop: '1rem', paddingTop: '0.75rem', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <button onClick={() => { setStep('form'); setError(''); }}
              disabled={submitting}
              style={{ padding: '0.55rem 1.2rem', fontSize: '0.85rem', cursor: submitting ? 'default' : 'pointer', fontWeight: 500, border: '1px solid #d1d5db', borderRadius: '6px', background: '#fff', opacity: submitting ? 0.5 : 1 }}>
              Back
            </button>
            <button onClick={submit} disabled={submitting}
              style={{ padding: '0.55rem 1.5rem', fontSize: '0.85rem', cursor: submitting ? 'default' : 'pointer', fontWeight: 600, border: 'none', borderRadius: '6px', background: submitting ? '#9ca3af' : '#16a34a', color: '#fff', opacity: submitting ? 0.7 : 1 }}>
              {submitting ? 'Creating...' : 'Create Product'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
