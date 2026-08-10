import { useState, useEffect, useRef } from 'react';
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

function AlertIcon() { return <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 9v4M12 17h.01"/><path d="M3.09 21h17.82a1 1 0 0 0 .86-1.5L13.13 3.4a1 1 0 0 0-1.74 0L2.23 19.5a1 1 0 0 0 .86 1.5z"/></svg>; }
function CheckIcon() { return <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 6 9 17l-5-5"/></svg>; }
function PlusIcon() { return <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5v14"/></svg>; }
function TrashIcon() { return <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>; }

export default function ProductForm() {
  const slugManuallyEdited = useRef(false);
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
      if (key === 'name' && !slugManuallyEdited.current) {
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

  // N-13: these were React.CSSProperties objects spread into `style={}`.
  // Converted to Tailwind arbitrary-property classes (one class per CSS
  // property, exact same value) so the CSP style-src hash mechanism can
  // eventually cover this file. Call sites that used to spread-and-override
  // a property (e.g. `{...inputStyle, fontSize: '0.78rem'}`) resolve the
  // override into a single final class instead of emitting the property
  // twice — Tailwind's generated stylesheet order isn't guaranteed to match
  // className string order, so two classes setting the same property would
  // be ambiguous in a way the original object spread never was.
  const inputClass = "[width:100%] [padding:0.45rem_0.6rem] [font-size:0.82rem] [border:1px_solid_#d1d5db] [border-radius:6px] [outline:none] box-border [font-family:inherit]";
  const labelClass = "[font-size:0.78rem] [font-weight:600] [margin-bottom:0.3rem] block";
  const sectionHeadClass = "[font-size:0.9rem] [font-weight:700] [margin:1.25rem_0_0.75rem] [padding-bottom:0.4rem] [border-bottom:1px_solid_#e5e7eb]";

  if (result) {
    return (
      <div className="[font-family:system-ui,_sans-serif] [max-width:520px] [margin:2rem_auto] text-center">
        <div className="[width:56px] [height:56px] [border-radius:50%] [background:#dcfce7] flex items-center justify-center [margin:0_auto_1rem]">
          <CheckIcon />
        </div>
        <h2 className="[margin:0_0_0.25rem] [font-size:1.15rem] [font-weight:700]">Product Created</h2>
        <p className="[font-size:0.85rem] [color:#6b7280] [margin:0_0_1rem]">
          {form.name} &mdash; {variants.length} variant{variants.length > 1 ? 's' : ''}
        </p>
        <div className="flex [gap:0.5rem] justify-center flex-wrap">
          <a href={`/staff/products/${form.slug || result.productId}/edit`}
            className="[padding:0.5rem_1.2rem] [font-size:0.85rem] [font-weight:600] [border-radius:6px] [background:#6366f1] [color:#fff] no-underline">
            Edit Product
          </a>
          <button onClick={() => window.location.reload()}
            className="[padding:0.5rem_1.2rem] [font-size:0.85rem] [font-weight:600] cursor-pointer [border:1px_solid_#d1d5db] [border-radius:6px] [background:#fff]">
            Create Another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="[font-family:system-ui,_sans-serif] [max-width:860px]">
      {error && (
        <div className="[padding:0.6rem_0.85rem] [background:#fef2f2] [border:1px_solid_#fecaca] [border-radius:6px] [color:#991b1b] [font-size:0.8rem] [margin-bottom:0.75rem] flex items-center [gap:0.4rem]">
          <AlertIcon /> {error}
        </div>
      )}

      {step === 'form' ? (
        <div>
          {/* ───── BASIC INFO ───── */}
          <div className={sectionHeadClass}>Basic Information</div>
          <div className="grid [grid-template-columns:1fr_1fr] [gap:0.75rem]">
            <div className="[grid-column:1_/_-1]">
              <label className={labelClass}>Product Name *</label>
              <input type="text" value={form.name} onChange={e => setField('name', e.target.value)} maxLength={500}
                placeholder="e.g. Summer Floral Kurti" className={inputClass} />
            </div>
            <div className="[grid-column:1_/_-1]">
              <label className={labelClass}>Slug</label>
              <input type="text" value={form.slug} onChange={e => { slugManuallyEdited.current = true; setField('slug', e.target.value); }}
                maxLength={200} placeholder="auto-generated from name" className={`${inputClass} [color:#6b7280] font-mono [font-size:0.78rem]`} />
            </div>
            <div className="[grid-column:1_/_-1]">
              <label className={labelClass}>Description</label>
              <textarea value={form.description} onChange={e => setField('description', e.target.value)} maxLength={10000} rows={4}
                placeholder="Product description..." className={`${inputClass} resize-y`} />
              <span className="[font-size:0.7rem] [color:#9ca3af]">{form.description.length}/10000</span>
            </div>
            <div>
              <label className={labelClass}>Category</label>
              <select value={form.categoryId} onChange={e => setField('categoryId', e.target.value)} className={inputClass}>
                <option value="">No category</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Status</label>
              <select value={form.status} onChange={e => setField('status', e.target.value as 'draft' | 'published')} className={inputClass}>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
              </select>
            </div>
          </div>

          {/* ───── PRICING ───── */}
          <div className={sectionHeadClass}>Pricing</div>
          <div className="grid [grid-template-columns:1fr_1fr] [gap:0.75rem]">
            <div>
              <label className={labelClass}>Price (paisa) *</label>
              <input type="number" min="0" value={form.pricePaisa} onChange={e => setField('pricePaisa', e.target.value)}
                placeholder="e.g. 299900" className={inputClass} />
              <span className="[font-size:0.7rem] [color:#9ca3af]">
                {form.pricePaisa ? `৳ ${(parseInt(form.pricePaisa) / 100).toFixed(2)}` : ''}
              </span>
            </div>
            <div>
              <label className={labelClass}>Compare Price (paisa)</label>
              <input type="number" min="0" value={form.comparePricePaisa} onChange={e => setField('comparePricePaisa', e.target.value)}
                placeholder="e.g. 399900" className={inputClass} />
              <span className="[font-size:0.7rem] [color:#9ca3af]">
                {form.comparePricePaisa ? `৳ ${(parseInt(form.comparePricePaisa) / 100).toFixed(2)}` : ''}
              </span>
            </div>
            <div>
              <label className={`${labelClass} flex items-center [gap:0.4rem]`}>
                <input type="checkbox" checked={form.isFeatured} onChange={e => setField('isFeatured', e.target.checked)} />
                Featured product
              </label>
            </div>
          </div>

          {/* ───── SEO ───── */}
          <div className={sectionHeadClass}>SEO</div>
          <div className="grid [grid-template-columns:1fr_1fr] [gap:0.75rem]">
            <div className="[grid-column:1_/_-1]">
              <label className={labelClass}>Meta Title</label>
              <input type="text" value={form.metaTitle} onChange={e => setField('metaTitle', e.target.value)} maxLength={500}
                placeholder="SEO title (leave blank to use product name)" className={inputClass} />
              <span className="[font-size:0.7rem] [color:#9ca3af]">{form.metaTitle.length}/500</span>
            </div>
            <div className="[grid-column:1_/_-1]">
              <label className={labelClass}>Meta Description</label>
              <textarea value={form.metaDescription} onChange={e => setField('metaDescription', e.target.value)} maxLength={1000} rows={2}
                placeholder="SEO description..." className={`${inputClass} resize-y`} />
              <span className="[font-size:0.7rem] [color:#9ca3af]">{form.metaDescription.length}/1000</span>
            </div>
          </div>

          {/* ───── VARIANTS ───── */}
          <div className={`${sectionHeadClass} flex justify-between items-center`}>
            <span>Variants ({variants.length})</span>
            <button onClick={addVariant}
              className="flex items-center [gap:0.3rem] [padding:0.35rem_0.7rem] [font-size:0.78rem] [font-weight:600] cursor-pointer [border:1px_solid_#6366f1] [border-radius:6px] [background:#6366f1] [color:#fff]">
              <PlusIcon /> Add Variant
            </button>
          </div>

          <div className="overflow-x-auto [border:1px_solid_#e5e7eb] [border-radius:8px]">
            <table className="[width:100%] border-collapse [font-size:0.8rem]">
              <thead>
                <tr className="[background:#f9fafb] text-left">
                  <th className="[padding:0.45rem_0.5rem] [font-weight:600] whitespace-nowrap">SKU *</th>
                  <th className="[padding:0.45rem_0.5rem] [font-weight:600] whitespace-nowrap">Size</th>
                  <th className="[padding:0.45rem_0.5rem] [font-weight:600] whitespace-nowrap">Color</th>
                  <th className="[padding:0.45rem_0.5rem] [font-weight:600] whitespace-nowrap">Price (paisa)</th>
                  <th className="[padding:0.45rem_0.5rem] [font-weight:600] whitespace-nowrap">Stock</th>
                  <th className="[padding:0.45rem_0.5rem] [font-weight:600] whitespace-nowrap"></th>
                </tr>
              </thead>
              <tbody>
                {variants.map((v, i) => (
                  <tr key={i} className="[border-top:1px_solid_#f3f4f6]">
                    <td className="[padding:0.35rem_0.4rem]">
                      <div className="flex [gap:0.25rem] items-center">
                        <input type="text" value={v.sku} onChange={e => updateVariant(i, 'sku', e.target.value.toUpperCase())}
                          maxLength={100}
                          className="[width:110px] [padding:0.3rem_0.4rem] [font-size:0.75rem] [border:1px_solid_#d1d5db] [border-radius:4px] font-mono [outline:none]" />
                        <button onClick={() => autoFillSku(i)} title="Auto-fill SKU from slug+size+color"
                          className="[padding:0.2rem] cursor-pointer [border:none] [background:none] [color:#6366f1] [font-size:0.7rem]">
                          ↻
                        </button>
                      </div>
                    </td>
                    <td className="[padding:0.35rem_0.4rem]">
                      <input type="text" value={v.size ?? ''} onChange={e => updateVariant(i, 'size', e.target.value)} maxLength={50}
                        placeholder="e.g. M" className="[width:60px] [padding:0.3rem_0.4rem] [font-size:0.75rem] [border:1px_solid_#d1d5db] [border-radius:4px] [outline:none]" />
                    </td>
                    <td className="[padding:0.35rem_0.4rem]">
                      <input type="text" value={v.color ?? ''} onChange={e => updateVariant(i, 'color', e.target.value)} maxLength={50}
                        placeholder="e.g. Red" className="[width:72px] [padding:0.3rem_0.4rem] [font-size:0.75rem] [border:1px_solid_#d1d5db] [border-radius:4px] [outline:none]" />
                    </td>
                    <td className="[padding:0.35rem_0.4rem]">
                      <input type="number" min="0" value={v.pricePaisa ?? ''} onChange={e => updateVariant(i, 'pricePaisa', e.target.value ? parseInt(e.target.value) : null)}
                        placeholder={form.pricePaisa || '0'}
                        className="[width:90px] [padding:0.3rem_0.4rem] [font-size:0.75rem] [border:1px_solid_#d1d5db] [border-radius:4px] [outline:none]" />
                    </td>
                    <td className="[padding:0.35rem_0.4rem]">
                      <input type="number" min="0" value={v.stock} onChange={e => updateVariant(i, 'stock', parseInt(e.target.value) || 0)}
                        className="[width:60px] [padding:0.3rem_0.4rem] [font-size:0.75rem] [border:1px_solid_#d1d5db] [border-radius:4px] [outline:none]" />
                    </td>
                    <td className="[padding:0.35rem_0.4rem]">
                      <button onClick={() => removeVariant(i)} disabled={variants.length <= 1}
                        className={`[padding:0.25rem] [border:none] [background:none] ${variants.length > 1 ? '[cursor:pointer] [color:#ef4444] [opacity:1]' : '[cursor:default] [color:#d1d5db] [opacity:0.4]'}`}>
                        <TrashIcon />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ───── ACTIONS ───── */}
          <div className="[margin-top:1.25rem] [padding-top:0.75rem] [border-top:1px_solid_#e5e7eb] flex justify-end [gap:0.5rem]">
            <button onClick={() => { setError(''); setStep('review'); }}
              className="[padding:0.55rem_1.2rem] [font-size:0.85rem] [font-weight:600] cursor-pointer [border:none] [border-radius:6px] [background:#6366f1] [color:#fff]">
              Review &amp; Confirm
            </button>
          </div>
        </div>
      ) : (
        /* ───── REVIEW & CONFIRM ───── */
        <div>
          <div className="[background:#fffbeb] [border:1px_solid_#fde68a] [border-radius:8px] [padding:0.75rem_1rem] [margin-bottom:1rem] [font-size:0.8rem] flex [gap:0.4rem] items-start">
            <AlertIcon />
            <div>
              <strong>Review before creating</strong><br />
              This will create the product, {variants.length} variant{variants.length > 1 ? 's' : ''}, and initialize inventory. Audit-logged.
            </div>
          </div>

          <div className="grid [grid-template-columns:1fr_1fr] [gap:0.75rem] [font-size:0.82rem]">
            <div><span className="[color:#6b7280]">Name</span><br /><strong>{form.name}</strong></div>
            <div><span className="[color:#6b7280]">Slug</span><br /><span className="font-mono">{form.slug || '(auto)'}</span></div>
            {form.description && <div className="[grid-column:1_/_-1]"><span className="[color:#6b7280]">Description</span><br />{form.description}</div>}
            <div><span className="[color:#6b7280]">Category</span><br />{categories.find(c => c.id === form.categoryId)?.name || 'None'}</div>
            <div><span className="[color:#6b7280]">Status</span><br />{form.status === 'published' ? 'Published' : 'Draft'}</div>
            <div><span className="[color:#6b7280]">Price</span><br />৳ {(parseInt(form.pricePaisa) / 100).toFixed(2)}</div>
            <div><span className="[color:#6b7280]">Compare Price</span><br />{form.comparePricePaisa ? `৳ ${(parseInt(form.comparePricePaisa) / 100).toFixed(2)}` : 'None'}</div>
            <div><span className="[color:#6b7280]">Featured</span><br />{form.isFeatured ? 'Yes' : 'No'}</div>
            {form.metaTitle && <div><span className="[color:#6b7280]">Meta Title</span><br />{form.metaTitle}</div>}
            {form.metaDescription && <div><span className="[color:#6b7280]">Meta Description</span><br />{form.metaDescription}</div>}
          </div>

          <div className={`${sectionHeadClass} [margin-top:1rem]`}>Variants ({variants.length})</div>
          <div className="overflow-x-auto [border:1px_solid_#e5e7eb] [border-radius:8px] [font-size:0.8rem]">
            <table className="[width:100%] border-collapse">
              <thead>
                <tr className="[background:#f9fafb] text-left">
                  <th className="[padding:0.4rem_0.5rem] [font-weight:600]">SKU</th>
                  <th className="[padding:0.4rem_0.5rem] [font-weight:600]">Size</th>
                  <th className="[padding:0.4rem_0.5rem] [font-weight:600]">Color</th>
                  <th className="[padding:0.4rem_0.5rem] [font-weight:600] text-right">Price</th>
                  <th className="[padding:0.4rem_0.5rem] [font-weight:600] text-right">Stock</th>
                </tr>
              </thead>
              <tbody>
                {variants.map((v, i) => (
                  <tr key={i} className="[border-top:1px_solid_#f3f4f6]">
                    <td className="[padding:0.4rem_0.5rem] font-mono">{v.sku || '—'}</td>
                    <td className="[padding:0.4rem_0.5rem]">{v.size || '—'}</td>
                    <td className="[padding:0.4rem_0.5rem]">{v.color || '—'}</td>
                    <td className="[padding:0.4rem_0.5rem] text-right">
                      {v.pricePaisa != null ? `৳ ${(v.pricePaisa / 100).toFixed(2)}` : 'Default'}
                    </td>
                    <td className="[padding:0.4rem_0.5rem] text-right">{v.stock}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Actions */}
          <div className="[margin-top:1rem] [padding-top:0.75rem] [border-top:1px_solid_#e5e7eb] flex justify-end [gap:0.5rem]">
            <button onClick={() => { setStep('form'); setError(''); }}
              disabled={submitting}
              className={`[padding:0.55rem_1.2rem] [font-size:0.85rem] [font-weight:500] [border:1px_solid_#d1d5db] [border-radius:6px] [background:#fff] ${submitting ? '[cursor:default] [opacity:0.5]' : '[cursor:pointer] [opacity:1]'}`}>
              Back
            </button>
            <button onClick={submit} disabled={submitting}
              className={`[padding:0.55rem_1.5rem] [font-size:0.85rem] [font-weight:600] [border:none] [border-radius:6px] [color:#fff] ${submitting ? '[cursor:default] [background:#9ca3af] [opacity:0.7]' : '[cursor:pointer] [background:#16a34a] [opacity:1]'}`}>
              {submitting ? 'Creating...' : 'Create Product'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
