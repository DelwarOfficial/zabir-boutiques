# Zabir Boutiques Design System

A comprehensive guide to the design tokens, components, and patterns used throughout the Zabir Boutiques storefront.

## Table of Contents

1. [Design Principles](#design-principles)
2. [Color Palette](#color-palette)
3. [Typography](#typography)
4. [Spacing & Layout](#spacing--layout)
5. [Borders & Shadows](#borders--shadows)
6. [Responsive Design](#responsive-design)
7. [Motion & Animation](#motion--animation)
8. [Component Status](#component-status)

---

## Design Principles

### 1. **Clarity**
- Clear visual hierarchy with consistent typography
- Intuitive navigation and information architecture
- Accessible color contrast and readable fonts

### 2. **Simplicity**
- Minimal visual clutter
- Purposeful use of whitespace
- Single-purpose components

### 3. **Consistency**
- Unified token-based design across all pages
- Predictable component behavior
- Consistent interaction patterns

### 4. **Accessibility (WCAG 2.1 AA)**
- Minimum 4.5:1 contrast ratio for text
- Keyboard navigable interfaces
- Screen reader support with semantic HTML
- Respect for `prefers-reduced-motion`

### 5. **Performance**
- Lightweight CSS using CSS variables
- Hydration budgets for interactive islands
- Lazy loading for images
- Optimized animations

---

## Color Palette

### Light Mode

#### Brand Colors
| Token | Value | Usage |
|-------|-------|-------|
| `--brand-storefront` | `#bc1545` | Primary brand color (CTAs, links, accents) |
| `--brand-storefront-hover` | `#8a0c2f` | Hover state for brand elements |
| `--brand-storefront-light` | `#ffeef2` | Light background for brand highlights |
| `--brand-storefront-glow` | `rgba(188, 21, 69, 0.08)` | Focus ring and subtle highlights |

#### Surface Colors
| Token | Value | Usage |
|-------|-------|-------|
| `--bg-storefront` | `#faf9f7` | Page background |
| `--bg-storefront-subtle` | `#f5f3f0` | Secondary background |
| `--surface-storefront` | `#ffffff` | Cards, containers, surfaces |
| `--surface-storefront-soft` | `#f7f5f2` | Disabled states, subtle backgrounds |

#### Text & Border Colors
| Token | Value | Usage |
|-------|-------|-------|
| `--ink-storefront` | `#1c1917` | Primary text color |
| `--ink-storefront-secondary` | `#44403c` | Secondary text, muted content |
| `--border-storefront` | `#e7e5e4` | Primary borders |
| `--border-storefront-soft` | `#f0eeec` | Subtle borders, dividers |

#### Semantic Colors
| Token | Value | Usage |
|-------|-------|-------|
| `--success-storefront` | `#16a34a` | Success states, confirmations |
| `--danger-storefront` | `#dc2626` | Destructive actions, errors |
| `--warning-storefront` | `#ca8a04` | Warnings, cautions |

**Light Mode Example:**

```html
<div style="background: var(--surface-storefront); color: var(--ink-storefront); border: 1px solid var(--border-storefront);">
  Light mode card example
</div>
```

### Dark Mode

When `[data-theme="dark"]` is applied to the root element, the following tokens override:

#### Brand Colors (Dark)
| Token | Value | Usage |
|-------|-------|-------|
| `--brand-storefront` | `#f43f5e` | Adjusted for dark backgrounds |
| `--brand-storefront-hover` | `#fda4af` | Lighter hover state |
| `--brand-storefront-light` | `rgba(244, 63, 94, 0.12)` | Subtle background |
| `--brand-storefront-glow` | `rgba(244, 63, 94, 0.1)` | Focus ring |

#### Surface Colors (Dark)
| Token | Value | Usage |
|-------|-------|-------|
| `--bg-storefront` | `#1a1816` | Dark page background |
| `--bg-storefront-subtle` | `#211f1c` | Secondary background |
| `--surface-storefront` | `#262320` | Dark cards and surfaces |
| `--surface-storefront-soft` | `#2e2b27` | Disabled states |

#### Text & Border Colors (Dark)
| Token | Value | Usage |
|-------|-------|-------|
| `--ink-storefront` | `#f5f5f4` | Primary text (light) |
| `--ink-storefront-secondary` | `#d6d3d1` | Secondary text |
| `--border-storefront` | `#3d3832` | Dark borders |
| `--border-storefront-soft` | `#302c27` | Subtle dark borders |

#### Semantic Colors (Dark)
| Token | Value | Usage |
|-------|-------|-------|
| `--success-storefront` | `#22c55e` | Success (brighter for dark) |
| `--danger-storefront` | `#ef4444` | Danger (brighter for dark) |
| `--warning-storefront` | `#ea580c` | Warning (adjusted) |

**Dark Mode Implementation:**

```css
/* Automatically switched based on system preference or user selection */
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    /* CSS tokens override to dark values */
  }
}

/* Or explicitly set via data attribute */
[data-theme="dark"] {
  color-scheme: dark;
}
```

---

## Typography

### Font Families

```css
--font-sans: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
--font-serif: Georgia, "Times New Roman", serif;
```

### Type Scale

All sizes include line-height for readability:

| Size | CSS | Tailwind | Line-Height | Usage |
|------|-----|----------|-------------|-------|
| XS | `0.75rem` | `text-xs` | `1.25rem` | Captions, labels |
| SM | `0.875rem` | `text-sm` | `1.375rem` | Secondary text |
| Base | `1rem` | `text-base` | `1.5rem` | Body text |
| LG | `1.125rem` | `text-lg` | `1.75rem` | Emphasis |
| XL | `1.25rem` | `text-xl` | `1.75rem` | Subheadings |
| 2XL | `1.5rem` | `text-2xl` | `2rem` | Section headings |
| 3XL | `1.875rem` | `text-3xl` | `2.25rem` | Page headings |
| 4XL | `2.25rem` | `text-4xl` | `2.5rem` | Hero titles |

### Font Weights

| Weight | Usage |
|--------|-------|
| 400 (Normal) | Body text, standard content |
| 500 (Medium) | Slightly emphasized text |
| 600 (Semibold) | Strong emphasis, labels |
| 700 (Bold) | Headings, important content |

### Letter Spacing

| Token | Value | Usage |
|-------|-------|-------|
| `tracking-tight` | `-0.02em` | Headings for tighter appearance |
| `tracking-normal` | `0.01em` | Standard body text |
| `tracking-wide` | `0.02em` | Spaced emphasis, labels |

### Typography Examples

```html
<!-- Heading: Hero Title -->
<h1 class="text-4xl font-bold tracking-tight">Welcome to Zabir Boutiques</h1>

<!-- Heading: Section Title -->
<h2 class="text-2xl font-semibold">Featured Products</h2>

<!-- Body Text -->
<p class="text-base leading-relaxed">Premium fashion for modern occasions.</p>

<!-- Secondary Text -->
<p class="text-sm text-ink-secondary">Ships within 2-3 business days</p>

<!-- Label / Badge -->
<span class="text-xs font-semibold tracking-wide">NEW ARRIVAL</span>
```

---

## Spacing & Layout

### Spacing Scale

| Token | Size | Tailwind | Usage |
|-------|------|----------|-------|
| XS | `0.25rem` | `p-xs` | Tight spacing (4px) |
| SM | `0.5rem` | `p-sm` | Compact spacing (8px) |
| MD | `1rem` | `p-md` | Standard spacing (16px) |
| LG | `1.5rem` | `p-lg` | Relaxed spacing (24px) |
| XL | `2rem` | `p-xl` | Large spacing (32px) |
| 2XL | `2.5rem` | `p-2xl` | Extra large spacing (40px) |
| 3XL | `3rem` | `p-3xl` | Maximum spacing (48px) |

### Layout Patterns

#### Mobile-First Approach
- Start with single-column layouts
- Stack content vertically on mobile (< 640px)
- Expand to 2-3 columns on larger screens

#### Grid System
```html
<!-- Responsive product grid: 1 col mobile, 2 cols tablet, 3-4 cols desktop -->
<div class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
  <div>Product Card</div>
</div>
```

#### Safe Areas (iOS Notch Support)
```css
.safe-top    { padding-top: env(safe-area-inset-top); }
.safe-bottom { padding-bottom: env(safe-area-inset-bottom); }
```

---

## Borders & Shadows

### Border Radius

| Token | Size | Tailwind | Usage |
|-------|------|----------|-------|
| `--radius-storefront-sm` | `0.375rem` | `rounded-sm` | Small elements (6px) |
| `--radius-storefront-md` | `0.75rem` | `rounded-md` | Buttons, inputs (12px) |
| `--radius-storefront-lg` | `1.125rem` | `rounded-lg` | Cards, modals (18px) |

### Shadow System

| Token | Shadow | Usage |
|-------|--------|-------|
| `--shadow-storefront-sm` | `0 1px 3px rgba(28, 25, 23, 0.04)` | Subtle elevation |
| `--shadow-storefront-md` | `0 4px 20px rgba(28, 25, 23, 0.06)` | Card elevation |
| `--shadow-storefront-lg` | `0 8px 40px rgba(28, 25, 23, 0.08)` | Modal/drawer elevation |

**Light Mode Shadows:**
```css
.shadow-sm { box-shadow: 0 1px 3px rgba(28, 25, 23, 0.04); }
.shadow-md { box-shadow: 0 4px 20px rgba(28, 25, 23, 0.06); }
.shadow-lg { box-shadow: 0 8px 40px rgba(28, 25, 23, 0.08); }
```

**Dark Mode Shadows:**
```css
[data-theme="dark"] .shadow-sm { box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2); }
[data-theme="dark"] .shadow-md { box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3); }
[data-theme="dark"] .shadow-lg { box-shadow: 0 8px 40px rgba(0, 0, 0, 0.4); }
```

### Border Styles

```css
/* Hairline border (1px) */
.hairline {
  box-shadow: inset 0 0 0 1px var(--border-storefront);
}

/* Glass morphism effect */
.glass {
  background: var(--surface);
  backdrop-filter: blur(16px) saturate(1.8);
}
```

---

## Responsive Design

### Breakpoints

| Name | Size | Tailwind Prefix | Usage |
|------|------|-----------------|-------|
| XS | 360px | `xs:` | Small phones |
| SM | 640px | `sm:` | Phones, small tablets |
| MD | 1024px | `md:` | Tablets, small laptops |
| LG | 1280px | `lg:` | Desktops |
| XL | 1536px | `xl:` | Large desktops |

### Mobile-First Pattern

```html
<!-- Default: mobile (360px+) -->
<!-- sm: adds styles from 640px+ -->
<!-- md: adds styles from 1024px+ -->
<div class="w-full sm:w-1/2 md:w-1/3 lg:w-1/4">
  Responsive width: 100% → 50% → 33% → 25%
</div>
```

### Touch-Friendly Targets

```css
/* Minimum 44px tap target for accessibility */
.tap-44 { min-height: 44px; min-width: 44px; }
```

### Media Queries

```css
/* Dark mode support */
@media (prefers-color-scheme: dark) {
  /* Dark mode styles automatically applied */
}

/* Reduced motion support */
@media (prefers-reduced-motion: reduce) {
  * { animation-duration: 0.01ms !important; }
}

/* Touch devices (no hover) */
@media (hover: none) {
  .shine-card:active { transform: scale(0.98); }
}
```

---

## Motion & Animation

### Animations

| Animation | Duration | Timing | Usage |
|-----------|----------|--------|-------|
| `fade-up` | 360ms | cubic-bezier(0.2, 0.7, 0.2, 1) | Entrance from bottom |
| `fade-in` | 240ms | ease | Simple fade entrance |
| `pop` | 320ms | cubic-bezier(0.2, 0.8, 0.2, 1) | Scale + pop effect |
| `pulse-ring` | 1.2s | ease-out (infinite) | Loading indicators |

### Animation Usage

```html
<!-- Fade-up entrance -->
<div class="animate-fade-up">Content</div>

<!-- Fade-in (faster) -->
<div class="animate-fade-in">Quick entry</div>

<!-- Pop effect for emphasis -->
<button class="animate-pop">Click me!</button>

<!-- Pulse ring for loading -->
<div class="animate-pulse-ring">Loading...</div>
```

### Staggered Animations

```html
<!-- Children animate with stagger delays -->
<div class="stagger">
  <div>Item 1 - delay 0ms</div>
  <div>Item 2 - delay 60ms</div>
  <div>Item 3 - delay 120ms</div>
</div>
```

### Respecting Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## Component Status

### Primitives (In Progress)

- [ ] **Button** - Primary, secondary, danger, ghost variants
- [ ] **Input** - Text, email, password, tel, number types
- [ ] **Select** - Dropdown with accessibility
- [ ] **Badge** - Status indicators
- [ ] **Modal** - Focus trap, keyboard support
- [ ] **Toast** - Auto-dismiss notifications
- [ ] **Spinner** - Loading indicator

### Product Components (In Progress)

- [ ] **ProductCard** - Image, title, price, variants, stock
- [ ] **ProductGallery** - Image viewer with thumbnails
- [ ] **VariantSelector** - Size/color selection
- [ ] **PriceDisplay** - Price formatting with symbols
- [ ] **StockBadge** - Inventory status

### Layout Components (In Progress)

- [ ] **Header** - Logo, search, cart, mobile menu
- [ ] **Footer** - Links, social, company info
- [ ] **Breadcrumb** - Navigation path
- [ ] **MobileMenu** - Responsive navigation

### Pages (Planned)

- [ ] **Homepage** - Hero, featured, categories
- [ ] **Category Listing** - Products with filters
- [ ] **Product Detail** - Gallery, variants, reviews
- [ ] **Cart** - Item management
- [ ] **Checkout** - Multi-step form
- [ ] **Order Confirmation** - Receipt

---

## Best Practices

### Color Usage

✅ **DO:**
- Use semantic color tokens (brand, success, danger)
- Combine colors for contrast and readability
- Test color combinations for WCAG AA compliance (4.5:1)
- Use `--brand-storefront-glow` for focus rings

❌ **DON'T:**
- Hardcode colors; use CSS variables
- Rely on color alone for meaning (add text/icon)
- Use color contrast lower than 4.5:1 for text

### Typography

✅ **DO:**
- Use the type scale for consistent sizing
- Apply appropriate line-height for readability
- Use `font-semibold` for emphasis, not color alone
- Include letter-spacing for headings

❌ **DON'T:**
- Mix multiple font families
- Use text sizes outside the defined scale
- Apply excessive font-weight to body text

### Spacing

✅ **DO:**
- Use tokens from the spacing scale
- Apply consistent gaps between components
- Use margin for external spacing, padding for internal
- Add whitespace for visual hierarchy

❌ **DON'T:**
- Mix different spacing systems
- Hardcode pixel values
- Overcrowd content; use generous whitespace

### Animations

✅ **DO:**
- Keep animations under 400ms
- Respect `prefers-reduced-motion`
- Use easing functions for natural motion
- Animate intentionally (not gratuitously)

❌ **DON'T:**
- Use animation without purpose
- Ignore reduced motion preferences
- Create distracting or jarring transitions

---

## Accessing Tokens in Code

### CSS

```css
.card {
  background: var(--surface-storefront);
  color: var(--ink-storefront);
  border: 1px solid var(--border-storefront);
  border-radius: var(--radius-storefront-md);
  box-shadow: var(--shadow-storefront-md);
}
```

### Tailwind CSS

```html
<!-- Background and text color -->
<div class="bg-surface text-ink">Content</div>

<!-- Border and shadow -->
<div class="border border-border shadow-md rounded-md">Card</div>

<!-- Responsive sizing -->
<div class="p-md sm:p-lg md:p-xl">Responsive padding</div>

<!-- Animation -->
<div class="animate-fade-up">Entrance animation</div>
```

### Astro Components

```astro
---
// Use CSS variables in component styles
---

<div class="card-component">
  <h2>Component Title</h2>
  <p>Component content</p>
</div>

<style>
  .card-component {
    background: var(--surface-storefront);
    padding: var(--spacing-md);
    border-radius: var(--radius-storefront-md);
    box-shadow: var(--shadow-storefront-md);
  }
</style>
```

---

## Testing Design Tokens

### Browser DevTools

1. Open DevTools (F12)
2. Go to **Styles** tab
3. Inspect an element using design tokens
4. Verify computed CSS variable values
5. Test light/dark mode toggle

### Lighthouse Audit

```bash
npm run build
npm run preview
# Run Lighthouse in Chrome DevTools (Ctrl+Shift+P → Lighthouse)
```

### Accessibility Testing

```bash
# Use axe DevTools browser extension
# Check color contrast: 4.5:1 minimum
# Verify focus ring visibility
# Test keyboard navigation
```

---

## Changelog

### v1.0.0 (Current)

- ✅ Design tokens defined (colors, spacing, typography)
- ✅ Tailwind config created
- ✅ Light/dark mode support
- ✅ Mobile-first responsive design
- ✅ Accessibility standards (WCAG 2.1 AA)
- 🔄 Primitive components (in progress)

For detailed changelog, see [CHANGELOG.md](./CHANGELOG.md)

---

## Support

For questions about the design system, refer to:
- [Component API Reference](./COMPONENTS.md) (coming soon)
- [Accessibility Guidelines](./ACCESSIBILITY.md) (coming soon)
- [Performance Guidelines](./PERFORMANCE.md) (coming soon)

