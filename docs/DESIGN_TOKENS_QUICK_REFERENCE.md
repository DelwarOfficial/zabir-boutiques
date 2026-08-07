# Design Tokens Quick Reference

A quick lookup guide for commonly used design tokens in Zabir Boutiques storefront.

## Colors

### Brand
```css
--brand-storefront: #bc1545;              /* Primary brand red */
--brand-storefront-hover: #8a0c2f;        /* Darker on hover */
--brand-storefront-light: #ffeef2;        /* Light pink background */
--brand-storefront-glow: rgba(188,21,69,0.08); /* Focus ring tint */
```

### Surfaces
```css
--bg-storefront: #faf9f7;                 /* Page background */
--surface-storefront: #ffffff;            /* Cards, containers */
--surface-storefront-soft: #f7f5f2;       /* Disabled states */
```

### Text
```css
--ink-storefront: #1c1917;                /* Primary text */
--ink-storefront-secondary: #44403c;      /* Secondary/muted text */
```

### Borders
```css
--border-storefront: #e7e5e4;             /* Primary border */
--border-storefront-soft: #f0eeec;        /* Subtle border */
```

### Semantic
```css
--success-storefront: #16a34a;            /* Green - success */
--danger-storefront: #dc2626;             /* Red - destructive */
--warning-storefront: #ca8a04;            /* Amber - warning */
```

## Spacing

```css
--xs:  0.25rem  (4px)
--sm:  0.5rem   (8px)
--md:  1rem     (16px)
--lg:  1.5rem   (24px)
--xl:  2rem     (32px)
--2xl: 2.5rem   (40px)
--3xl: 3rem     (48px)
```

## Border Radius

```css
--radius-storefront-sm: 0.375rem   (6px)
--radius-storefront-md: 0.75rem    (12px)
--radius-storefront-lg: 1.125rem   (18px)
```

## Shadows

```css
--shadow-storefront-sm: 0 1px 3px rgba(28, 25, 23, 0.04)
--shadow-storefront-md: 0 4px 20px rgba(28, 25, 23, 0.06)
--shadow-storefront-lg: 0 8px 40px rgba(28, 25, 23, 0.08)
```

## Common Tailwind Classes

```html
<!-- Colors -->
<div class="bg-surface text-ink border border-border">
  
<!-- Spacing -->
<div class="p-md sm:p-lg md:p-xl gap-md">

<!-- Border & Shadow -->
<div class="rounded-md shadow-md border border-border">

<!-- Responsive -->
<div class="w-full sm:w-1/2 md:w-1/3 lg:w-1/4">

<!-- Animations -->
<div class="animate-fade-up animate-pop">

<!-- Typography -->
<h1 class="text-4xl font-bold tracking-tight">Title</h1>
<p class="text-sm text-ink-secondary">Secondary text</p>
```

## Dark Mode

Automatic via `prefers-color-scheme: dark` or toggle `[data-theme="dark"]`:

```javascript
// Toggle dark mode
document.documentElement.setAttribute('data-theme', 'dark');
document.documentElement.removeAttribute('data-theme'); // light
```

## Mobile-First Breakpoints

| Name | Width | Tailwind |
|------|-------|----------|
| XS   | 360px | `xs:`    |
| SM   | 640px | `sm:`    |
| MD   | 1024px| `md:`    |
| LG   | 1280px| `lg:`    |
| XL   | 1536px| `xl:`    |

```html
<!-- Responsive example -->
<div class="col-span-1 sm:col-span-2 md:col-span-3 lg:col-span-4">
  <!-- 1 col on mobile, 2 on sm, 3 on md, 4 on lg -->
</div>
```

## Animations

| Name | Duration | Usage |
|------|----------|-------|
| `fade-up` | 360ms | Entrance from bottom |
| `fade-in` | 240ms | Simple fade |
| `pop` | 320ms | Scale effect |
| `pulse-ring` | 1.2s | Loading indicator |

```html
<div class="animate-fade-up">Enters smoothly</div>
<button class="animate-pop">Pops in on load</button>
```

## Accessibility

### Colors Must Have Contrast
- Minimum 4.5:1 for normal text
- Test: Use WebAIM Contrast Checker

### Focus Ring
```css
.custom-focus {
  outline: none;
  box-shadow: 0 0 0 3px var(--brand-storefront-glow),
              0 0 0 1px var(--brand-storefront);
}
```

### Reduced Motion
```css
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; }
}
```

## Usage Examples

### Card Component
```html
<div class="bg-surface border border-border rounded-lg shadow-md p-lg">
  <h3 class="text-lg font-semibold text-ink">Card Title</h3>
  <p class="text-sm text-ink-secondary mt-md">Description</p>
</div>
```

### Button
```html
<button class="bg-brand text-white px-lg py-md rounded-md hover:bg-brand-hover">
  Click me
</button>
```

### Product Grid (Responsive)
```html
<div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-lg">
  <div class="bg-surface rounded-lg shadow-md overflow-hidden">
    <img class="aspect-4/5 object-cover" src="..." alt="...">
    <div class="p-md">
      <h4 class="font-semibold text-ink">Product Name</h4>
      <p class="text-lg font-bold text-brand">Tk. 1,299</p>
    </div>
  </div>
</div>
```

### Form Input
```html
<input 
  type="text"
  class="w-full px-md py-sm border border-border rounded-md focus:border-brand focus:ring-3 focus:ring-brand-glow"
  placeholder="Enter text"
/>
```

## Files to Reference

- **Token Definition**: `src/styles/tokens.css`
- **Tailwind Config**: `tailwind.config.ts`
- **Full Guide**: `docs/DESIGN_SYSTEM.md`
- **Completion Report**: `docs/GROUP_1_COMPLETION.md`

## Testing

```bash
# Verify tokens in browser
# 1. Open DevTools (F12)
# 2. Inspect an element using tokens
# 3. Check Computed Styles tab
# 4. All CSS variables should resolve correctly

# Test Tailwind classes
# 1. Use DevTools Inspect
# 2. Hover over element with Tailwind classes
# 3. CSS rules should show correct values from tokens

# Test dark mode
# DevTools Console:
# document.documentElement.setAttribute('data-theme', 'dark')
# Toggle back with removeAttribute('data-theme')
```

---

**For detailed documentation, see `docs/DESIGN_SYSTEM.md`**

