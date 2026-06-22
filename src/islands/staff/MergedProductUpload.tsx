import { useState, useRef, useCallback, useEffect } from 'react';
import type { Category, VariantInput } from '../../types/product';

function getCsrf(): string {
  if (typeof window.__ZB_CSRF__ === 'string' && window.__ZB_CSRF__) return window.__ZB_CSRF__;
  try { return sessionStorage.getItem('zb-csrf') || ''; } catch { return ''; }
}

function slugify(name: string): string {
  return name.toLowerCase()
    .replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 200) || '';
}

const steps = [
  { label: 'Basic Info', icon: '📋' },
  { label: 'Variants', icon: '🏷️' },
  { label: 'Media', icon: '🖼️' },
  { label: 'Review & Publish', icon: '✅' },
];

const INPUT_CLS = 'w-full px-3 py-2 text-sm border border-line rounded-lg bg-surface text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-all box-border';
const LABEL_CLS = 'block text-xs font-semibold text-ink-secondary mb-1.5';
const SECTION_CLS = 'text-sm font-bold text-ink border-b border-line pb-2 mb-4 mt-2';
const BTN_CLS = 'px-4 py-2 text-sm font-semibold rounded-lg border-0 cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed';

interface QueuedImage {
  file: File;
  preview: string;
  uploaded: boolean;
  r2Key?: string;
  error?: string;
}

export default function MergedProductUpload() {
  const [step, setStep] = useState(0);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Step 1: Basic Info
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [slug, setSlug] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [pricePaisa, setPricePaisa] = useState('');
  const [comparePricePaisa, setComparePricePaisa] = useState('');
  const [status, setStatus] = useState<'draft' | 'published'>('draft');
  const [isFeatured, setIsFeatured] = useState(false);
  const [metaTitle, setMetaTitle] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const slugEdited = useRef(false);

  // Step 2: Variants
  const [variants, setVariants] = useState<VariantInput[]>([
    { sku: '', size: '', color: '', pricePaisa: null, stock: 0 },
  ]);

  // Step 3: Media
  const [images, setImages] = useState<QueuedImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Result
  const [result, setResult] = useState<{ productId: string; name: string; variantCount: number } | null>(null);

  // Load categories once
  useEffect(() => {
    fetch('/api/staff/products/categories', { headers: { 'X-CSRF-Token': getCsrf() } })
      .then(r => r.json() as Promise<{ ok: boolean; categories: Category[] }>)
      .then(d => { if (d.ok) setCategories(d.categories); })
      .catch(() => {});
  }, []);

  const handleNameChange = useCallback((val: string) => {
    setName(val);
    if (!slugEdited.current) setSlug(slugify(val));
  }, []);

  // ─── Variant helpers ───

  function updateVariant(i: number, field: keyof VariantInput, value: string | number | null) {
    setVariants(prev => { const n = [...prev]; n[i] = { ...n[i], [field]: value as never }; return n; });
  }

  function addVariant() {
    setVariants(prev => [...prev, { sku: '', size: '', color: '', pricePaisa: null, stock: 0 }]);
  }

  function removeVariant(i: number) {
    setVariants(prev => prev.length > 1 ? prev.filter((_, idx) => idx !== i) : prev);
  }

  function autoFillSku(i: number) {
    const s = slug || slugify(name);
    const v = variants[i];
    const parts = [s.toUpperCase().replace(/-/g, '_'), v.size?.toUpperCase(), v.color?.toUpperCase()].filter(Boolean);
    updateVariant(i, 'sku', parts.join('_'));
  }

  // ─── Media helpers ───

  function addFiles(files: FileList | File[]) {
    const valid: QueuedImage[] = [];
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'];
    for (const f of Array.from(files)) {
      if (!allowed.includes(f.type)) continue;
      if (f.size > 20 * 1024 * 1024) continue;
      valid.push({ file: f, preview: URL.createObjectURL(f), uploaded: false });
    }
    setImages(prev => [...prev, ...valid]);
  }

  function removeImage(i: number) {
    setImages(prev => {
      URL.revokeObjectURL(prev[i].preview);
      return prev.filter((_, idx) => idx !== i);
    });
  }

  // ─── Validation ───

  function validateBasic(): string | null {
    if (!name.trim()) return 'Product name is required';
    if (!pricePaisa || parseInt(pricePaisa) < 0) return 'Valid price is required';
    return null;
  }

  function validateVariants(): string | null {
    const skus = variants.map(v => v.sku.trim().toUpperCase());
    const unique = new Set(skus);
    if (unique.size !== skus.length) return 'Duplicate SKUs found';
    for (let i = 0; i < variants.length; i++) {
      if (!variants[i].sku.trim()) return `Variant ${i + 1}: SKU is required`;
    }
    return null;
  }

  // ─── Submit ───

  async function submit() {
    const basicErr = validateBasic();
    if (basicErr) { setError(basicErr); setStep(0); return; }
    const varErr = validateVariants();
    if (varErr) { setError(varErr); setStep(1); return; }

    setSubmitting(true);
    setError('');

    try {
      const res = await fetch('/api/staff/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': getCsrf() },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          slug: slug.trim() || null,
          categoryId: categoryId || null,
          pricePaisa: parseInt(pricePaisa),
          comparePricePaisa: comparePricePaisa ? parseInt(comparePricePaisa) : null,
          status,
          isFeatured,
          metaTitle: metaTitle.trim() || null,
          metaDescription: metaDescription.trim() || null,
          variants: variants.map(v => ({
            sku: v.sku.trim().toUpperCase(),
            size: v.size?.trim() || null,
            color: v.color?.trim() || null,
            pricePaisa: v.pricePaisa != null && v.pricePaisa > 0 ? v.pricePaisa : null,
            stock: v.stock,
          })),
        }),
      });
      const data: any = await res.json();
      if (!data.ok || !data.productId) {
        setError(data.error || 'Failed to create product');
        setSubmitting(false);
        return;
      }

      const productId = data.productId;

      // Upload queued images
      const uploadedKeys: string[] = [];
      for (let i = 0; i < images.length; i++) {
        const img = images[i];
        if (img.uploaded) continue;
        const fd = new FormData();
        fd.append('file', img.file);
        fd.append('product_id', productId);
        fd.append('alt_text', `${name} ${i + 1}`);
        try {
          const upRes = await fetch('/api/staff/uploads', {
            method: 'POST',
            headers: { 'X-CSRF-Token': getCsrf() },
            body: fd,
          });
          const upData: any = await upRes.json();
          if (upRes.ok && upData.ok) {
            uploadedKeys.push(upData.r2_key);
            setImages(prev => { const n = [...prev]; n[i] = { ...n[i], uploaded: true, r2Key: upData.r2_key }; return n; });
          } else {
            setImages(prev => { const n = [...prev]; n[i] = { ...n[i], error: upData.error || 'Upload failed' }; return n; });
          }
        } catch {
          setImages(prev => { const n = [...prev]; n[i] = { ...n[i], error: 'Network error' }; return n; });
        }
      }

      setResult({ productId, name: name.trim(), variantCount: variants.length });
    } catch {
      setError('Network error');
    }
    setSubmitting(false);
  }

  // ─── Success screen ───

  if (result) {
    return (
      <div className="max-w-lg mx-auto text-center py-8 fade-up">
        <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
          <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>
        </div>
        <h2 className="text-xl font-extrabold m-0">Product Created</h2>
        <p className="text-sm text-muted mt-1 mb-5">{result.name} &mdash; {result.variantCount} variant{result.variantCount > 1 ? 's' : ''}</p>
        {images.length > 0 && (
          <p className="text-xs text-ink-secondary mb-4">{images.filter(i => i.uploaded).length} of {images.length} images uploaded</p>
        )}
        <div className="flex gap-3 justify-center flex-wrap">
          <a href={`/staff/products/${result.productId}`} className="inline-flex items-center gap-1.5 px-4 py-2 bg-brand text-white text-sm font-semibold rounded-lg no-underline hover:opacity-90 transition-all">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            View Product
          </a>
          <button onClick={() => window.location.reload()} className="px-4 py-2 text-sm font-semibold rounded-lg border border-line bg-surface cursor-pointer hover:bg-surface-soft transition-all">
            Create Another
          </button>
        </div>
        {images.filter(i => i.error).length > 0 && (
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 text-left">
            <strong className="block mb-1">{images.filter(i => i.error).length} image(s) failed to upload:</strong>
            <ul className="list-disc pl-4 m-0 space-y-0.5">
              {images.filter(i => i.error).map((img, i) => (
                <li key={i}>{img.file.name}: {img.error}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  const gridCols = 'grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3';

  return (
    <div className="max-w-3xl">
      {error && (
        <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01"/><path d="M3.09 21h17.82a1 1 0 0 0 .86-1.5L13.13 3.4a1 1 0 0 0-1.74 0L2.23 19.5a1 1 0 0 0 .86 1.5z"/></svg>
          {error}
        </div>
      )}

      {/* Step indicator */}
      <div className="flex items-center gap-0 mb-6">
        {steps.map((s, i) => (
          <div key={i} className="flex items-center flex-1 last:flex-none">
            <button onClick={() => { if (i < step) setStep(i); setError(''); }}
              className={`flex items-center gap-1.5 px-2 py-1 text-xs font-semibold rounded-lg transition-all border-0 cursor-pointer
                ${i === step ? 'bg-brand text-white' : i < step ? 'bg-green-100 text-green-700' : 'bg-line-soft text-muted'}`}>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold
                ${i === step ? 'bg-white/20 text-white' : i < step ? 'bg-green-600 text-white' : 'bg-line text-muted'}`}>
                {i < step ? '✓' : i + 1}
              </span>
              <span className="hidden sm:inline">{s.label}</span>
            </button>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-px mx-2 ${i < step ? 'bg-green-400' : 'bg-line'}`} />
            )}
          </div>
        ))}
      </div>

      {/* ──────────── STEP 1: BASIC INFO ──────────── */}
      {step === 0 && (
        <div className="fade-up">
          <div className={SECTION_CLS}>
            <svg className="w-4 h-4 inline mr-1.5 mb-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
            Basic Information
          </div>
          <div className={gridCols}>
            <div className="col-span-full">
              <label className={LABEL_CLS}>Product Name *</label>
              <input type="text" value={name} onChange={e => handleNameChange(e.target.value)} maxLength={500} placeholder="e.g. Summer Floral Kurti" className={INPUT_CLS} />
            </div>
            <div className="col-span-full">
              <label className={LABEL_CLS}>Slug</label>
              <input type="text" value={slug} onChange={e => { slugEdited.current = true; setSlug(e.target.value); }} maxLength={200} placeholder="auto-generated from name" className={`${INPUT_CLS} font-mono text-xs text-muted`} />
            </div>
            <div className="col-span-full">
              <label className={LABEL_CLS}>Description</label>
              <textarea value={description} onChange={e => setDescription(e.target.value)} maxLength={10000} rows={4} placeholder="Product description..." className={`${INPUT_CLS} resize-y min-h-[80px]`} />
              <span className="text-[10px] text-muted">{description.length}/10000</span>
            </div>
            <div>
              <label className={LABEL_CLS}>Category</label>
              <select value={categoryId} onChange={e => setCategoryId(e.target.value)} className={INPUT_CLS}>
                <option value="">No category</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className={LABEL_CLS}>Status</label>
              <select value={status} onChange={e => setStatus(e.target.value as 'draft' | 'published')} className={INPUT_CLS}>
                <option value="draft">Draft</option>
                <option value="published">Published</option>
              </select>
            </div>
          </div>

          <div className={SECTION_CLS}>
            <svg className="w-4 h-4 inline mr-1.5 mb-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
            Pricing
          </div>
          <div className={gridCols}>
            <div>
              <label className={LABEL_CLS}>Price (paisa) *</label>
              <input type="number" min="0" value={pricePaisa} onChange={e => setPricePaisa(e.target.value)} placeholder="e.g. 299900" className={INPUT_CLS} />
              <span className="text-[10px] text-muted">{pricePaisa ? `৳ ${(parseInt(pricePaisa) / 100).toFixed(2)}` : ''}</span>
            </div>
            <div>
              <label className={LABEL_CLS}>Compare Price (paisa)</label>
              <input type="number" min="0" value={comparePricePaisa} onChange={e => setComparePricePaisa(e.target.value)} placeholder="e.g. 399900" className={INPUT_CLS} />
              <span className="text-[10px] text-muted">{comparePricePaisa ? `৳ ${(parseInt(comparePricePaisa) / 100).toFixed(2)}` : ''}</span>
            </div>
            <div className="col-span-full">
              <label className={`${LABEL_CLS} flex items-center gap-2 cursor-pointer`}>
                <input type="checkbox" checked={isFeatured} onChange={e => setIsFeatured(e.target.checked)} className="accent-brand w-4 h-4" />
                Featured product
              </label>
            </div>
          </div>

          <div className={SECTION_CLS}>
            <svg className="w-4 h-4 inline mr-1.5 mb-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
            SEO
          </div>
          <div className={gridCols}>
            <div className="col-span-full">
              <label className={LABEL_CLS}>Meta Title</label>
              <input type="text" value={metaTitle} onChange={e => setMetaTitle(e.target.value)} maxLength={500} placeholder="SEO title (leave blank to use product name)" className={INPUT_CLS} />
              <span className="text-[10px] text-muted">{metaTitle.length}/500</span>
            </div>
            <div className="col-span-full">
              <label className={LABEL_CLS}>Meta Description</label>
              <textarea value={metaDescription} onChange={e => setMetaDescription(e.target.value)} maxLength={1000} rows={2} placeholder="SEO description..." className={`${INPUT_CLS} resize-y min-h-[60px]`} />
              <span className="text-[10px] text-muted">{metaDescription.length}/1000</span>
            </div>
          </div>

          <div className="flex justify-end mt-6 pt-4 border-t border-line">
            <button onClick={() => { const err = validateBasic(); if (err) { setError(err); return; } setError(''); setStep(1); }} className={`${BTN_CLS} bg-brand text-white hover:opacity-90`}>
              Next: Variants
              <svg className="w-4 h-4 inline ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </button>
          </div>
        </div>
      )}

      {/* ──────────── STEP 2: VARIANTS ──────────── */}
      {step === 1 && (
        <div className="fade-up">
          <div className={SECTION_CLS}>
            <svg className="w-4 h-4 inline mr-1.5 mb-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M7 7h.01M7 3h.01M3 7h.01M3 3h.01M17 7h.01M17 3h.01M13 7h.01M13 3h.01M21 7h.01M21 3h.01"/>
              <rect x="3" y="11" width="18" height="10" rx="2"/></svg>
            Variants ({variants.length})
            <button onClick={addVariant} className="ml-3 inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md bg-brand text-white border-0 cursor-pointer hover:opacity-90">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5v14"/></svg>
              Add
            </button>
          </div>

          <div className="overflow-x-auto border border-line rounded-xl">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-surface-soft text-left">
                  <th className="px-2.5 py-2 font-semibold whitespace-nowrap">SKU *</th>
                  <th className="px-2.5 py-2 font-semibold whitespace-nowrap">Size</th>
                  <th className="px-2.5 py-2 font-semibold whitespace-nowrap">Color</th>
                  <th className="px-2.5 py-2 font-semibold whitespace-nowrap">Price</th>
                  <th className="px-2.5 py-2 font-semibold whitespace-nowrap">Stock</th>
                  <th className="px-2.5 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {variants.map((v, i) => (
                  <tr key={i} className="border-t border-line-soft">
                    <td className="px-2.5 py-1.5">
                      <div className="flex items-center gap-1">
                        <input type="text" value={v.sku} onChange={e => updateVariant(i, 'sku', e.target.value.toUpperCase())} maxLength={100}
                          placeholder="SKU" className="w-24 px-2 py-1.5 text-[11px] border border-line rounded-lg bg-surface outline-none focus:border-brand font-mono" />
                        <button onClick={() => autoFillSku(i)} title="Auto-fill SKU"
                          className="p-1 border-0 bg-none cursor-pointer text-brand hover:opacity-70 text-xs">↻</button>
                      </div>
                    </td>
                    <td className="px-2.5 py-1.5">
                      <input type="text" value={v.size ?? ''} onChange={e => updateVariant(i, 'size', e.target.value)} maxLength={50}
                        placeholder="e.g. M" className="w-16 px-2 py-1.5 text-[11px] border border-line rounded-lg bg-surface outline-none focus:border-brand" />
                    </td>
                    <td className="px-2.5 py-1.5">
                      <input type="text" value={v.color ?? ''} onChange={e => updateVariant(i, 'color', e.target.value)} maxLength={50}
                        placeholder="e.g. Red" className="w-20 px-2 py-1.5 text-[11px] border border-line rounded-lg bg-surface outline-none focus:border-brand" />
                    </td>
                    <td className="px-2.5 py-1.5">
                      <input type="number" min="0" value={v.pricePaisa ?? ''} onChange={e => updateVariant(i, 'pricePaisa', e.target.value ? parseInt(e.target.value) : null)}
                        placeholder="Default" className="w-20 px-2 py-1.5 text-[11px] border border-line rounded-lg bg-surface outline-none focus:border-brand" />
                    </td>
                    <td className="px-2.5 py-1.5">
                      <input type="number" min="0" value={v.stock} onChange={e => updateVariant(i, 'stock', parseInt(e.target.value) || 0)}
                        className="w-16 px-2 py-1.5 text-[11px] border border-line rounded-lg bg-surface outline-none focus:border-brand" />
                    </td>
                    <td className="px-2.5 py-1.5">
                      <button onClick={() => removeVariant(i)} disabled={variants.length <= 1}
                        className="p-1 border-0 bg-none cursor-pointer disabled:cursor-default"
                        style={{ color: variants.length > 1 ? '#ef4444' : '#d1d5db' }}>
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex justify-between mt-6 pt-4 border-t border-line">
            <button onClick={() => { setError(''); setStep(0); }} className={`${BTN_CLS} border border-line bg-surface text-ink hover:bg-surface-soft`}>
              <svg className="w-4 h-4 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
              Back
            </button>
            <button onClick={() => { const err = validateVariants(); if (err) { setError(err); return; } setError(''); setStep(2); }} className={`${BTN_CLS} bg-brand text-white hover:opacity-90`}>
              Next: Media
              <svg className="w-4 h-4 inline ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </button>
          </div>
        </div>
      )}

      {/* ──────────── STEP 3: MEDIA ──────────── */}
      {step === 2 && (
        <div className="fade-up">
          <div className={SECTION_CLS}>
            <svg className="w-4 h-4 inline mr-1.5 mb-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M4 16l4.5-4.5a2 2 0 0 1 2.83 0L16 16m-2-2l1.5-1.5a2 2 0 0 1 2.83 0L20 16"/><rect x="2" y="4" width="20" height="16" rx="2"/></svg>
            Media — Images will upload after product creation
          </div>

          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('border-[var(--brand)]', 'bg-[var(--brand)]/5'); }}
            onDragLeave={e => { e.preventDefault(); e.currentTarget.classList.remove('border-[var(--brand)]', 'bg-[var(--brand)]/5'); }}
            onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('border-[var(--brand)]', 'bg-[var(--brand)]/5'); addFiles(e.dataTransfer.files); }}
            className="border-2 border-dashed border-line rounded-xl p-8 text-center cursor-pointer hover:border-brand/40 transition-all mb-4"
            onClick={() => fileInputRef.current?.click()}
          >
            <svg className="w-8 h-8 mx-auto text-muted mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5"><path d="M7 16a4 4 0 0 1-.88-7.903A5 5 0 1 1 15.9 6L16 6a5 5 0 0 1 1 9.9M15 13l-3-3m0 0-3 3m3-3v12"/></svg>
            <p className="text-sm text-ink-secondary m-0">Drop images here or click to browse</p>
            <p className="text-[10px] text-muted mt-1 m-0">JPEG, PNG, WebP, GIF, AVIF — max 20MB each</p>
            <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" multiple
              className="hidden" onChange={e => { if (e.target.files) addFiles(e.target.files); }} />
          </div>

          {/* Image previews */}
          {images.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 mb-4">
              {images.map((img, i) => (
                <div key={i} className="relative group rounded-xl overflow-hidden border border-line bg-surface">
                  <img src={img.preview} alt={img.file.name} className="w-full h-24 object-cover" />
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-all flex items-center justify-center gap-2">
                    <button onClick={() => removeImage(i)}
                      className="opacity-0 group-hover:opacity-100 p-1.5 bg-red-500 text-white rounded-full border-0 cursor-pointer transition-all hover:bg-red-600">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12"/></svg>
                    </button>
                  </div>
                  <div className="px-2 py-1">
                    <p className="text-[10px] text-muted truncate m-0">{img.file.name}</p>
                    <p className="text-[9px] text-muted m-0">{(img.file.size / 1024).toFixed(0)} KB</p>
                  </div>
                  {img.uploaded && <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-green-500 flex items-center justify-center"><svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg></div>}
                  {img.error && <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-red-500 flex items-center justify-center"><svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path d="M6 18L18 6M6 6l12 12"/></svg></div>}
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-between mt-6 pt-4 border-t border-line">
            <button onClick={() => { setError(''); setStep(1); }} className={`${BTN_CLS} border border-line bg-surface text-ink hover:bg-surface-soft`}>
              <svg className="w-4 h-4 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
              Back
            </button>
            <button onClick={() => { setError(''); setStep(3); }} className={`${BTN_CLS} bg-brand text-white hover:opacity-90`}>
              Next: Review
              <svg className="w-4 h-4 inline ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </button>
          </div>
        </div>
      )}

      {/* ──────────── STEP 4: REVIEW & PUBLISH ──────────── */}
      {step === 3 && (
        <div className="fade-up">
          <div className="flex items-start gap-2 p-3 mb-5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800">
            <svg className="w-4 h-4 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M12 9v4M12 17h.01"/><path d="M3.09 21h17.82a1 1 0 0 0 .86-1.5L13.13 3.4a1 1 0 0 0-1.74 0L2.23 19.5a1 1 0 0 0 .86 1.5z"/></svg>
            <div>
              <strong className="block mb-0.5">Review before creating</strong>
              This will create the product, {variants.length} variant{variants.length > 1 ? 's' : ''}, initialize inventory, and upload {images.length} image{images.length !== 1 ? 's' : ''}. All changes are audit-logged.
            </div>
          </div>

          {/* Summary grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div><span className="text-muted text-xs block">Name</span><span className="font-semibold">{name}</span></div>
            <div><span className="text-muted text-xs block">Slug</span><span className="font-mono text-xs">{slug || '(auto)'}</span></div>
            {description && <div className="col-span-full"><span className="text-muted text-xs block">Description</span><span>{description.length > 120 ? description.slice(0, 120) + '...' : description}</span></div>}
            <div><span className="text-muted text-xs block">Category</span><span>{categories.find(c => c.id === categoryId)?.name || 'None'}</span></div>
            <div><span className="text-muted text-xs block">Status</span><span className={status === 'published' ? 'text-green-600 font-semibold' : ''}>{status === 'published' ? 'Published' : 'Draft'}</span></div>
            <div><span className="text-muted text-xs block">Price</span><span className="font-semibold">৳ {(parseInt(pricePaisa) / 100).toFixed(2)}</span></div>
            <div><span className="text-muted text-xs block">Compare Price</span><span>{comparePricePaisa ? `৳ ${(parseInt(comparePricePaisa) / 100).toFixed(2)}` : 'None'}</span></div>
            <div><span className="text-muted text-xs block">Featured</span><span>{isFeatured ? 'Yes' : 'No'}</span></div>
            {metaTitle && <div className="col-span-full"><span className="text-muted text-xs block">Meta Title</span><span className="text-xs">{metaTitle}</span></div>}
          </div>

          {/* Variants summary */}
          <div className={SECTION_CLS}>Variants ({variants.length})</div>
          <div className="overflow-x-auto border border-line rounded-xl text-xs mb-4">
            <table className="w-full border-collapse">
              <thead><tr className="bg-surface-soft text-left">
                <th className="px-2.5 py-1.5 font-semibold">SKU</th>
                <th className="px-2.5 py-1.5 font-semibold">Size</th>
                <th className="px-2.5 py-1.5 font-semibold">Color</th>
                <th className="px-2.5 py-1.5 font-semibold text-right">Price</th>
                <th className="px-2.5 py-1.5 font-semibold text-right">Stock</th>
              </tr></thead>
              <tbody>{variants.map((v, i) => (
                <tr key={i} className="border-t border-line-soft">
                  <td className="px-2.5 py-1.5 font-mono">{v.sku || '—'}</td>
                  <td className="px-2.5 py-1.5">{v.size || '—'}</td>
                  <td className="px-2.5 py-1.5">{v.color || '—'}</td>
                  <td className="px-2.5 py-1.5 text-right">{v.pricePaisa != null ? `৳ ${(v.pricePaisa / 100).toFixed(2)}` : 'Default'}</td>
                  <td className="px-2.5 py-1.5 text-right">{v.stock}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>

          {/* Images summary */}
          {images.length > 0 && (
            <>
              <div className={SECTION_CLS}>Media ({images.length})</div>
              <div className="flex flex-wrap gap-2 mb-4">
                {images.map((img, i) => (
                  <div key={i} className="relative w-16 h-16 rounded-lg overflow-hidden border border-line">
                    <img src={img.preview} alt="" className="w-full h-full object-cover" />
                  </div>
                ))}
              </div>
            </>
          )}

          <div className="flex justify-between mt-6 pt-4 border-t border-line">
            <button onClick={() => { setError(''); setStep(2); }} disabled={submitting}
              className={`${BTN_CLS} border border-line bg-surface text-ink hover:bg-surface-soft`}>
              <svg className="w-4 h-4 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
              Back
            </button>
            <button onClick={submit} disabled={submitting}
              className={`${BTN_CLS} ${submitting ? 'bg-muted' : 'bg-green-600 hover:bg-green-700'} text-white flex items-center gap-1.5`}>
              {submitting ? (
                <>
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3" className="opacity-30"/><path d="M4 12a8 8 0 018-8" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>
                  Creating...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M5 13l4 4L19 7"/></svg>
                  Create Product &amp; Upload
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
