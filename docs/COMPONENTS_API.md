# Component API Reference

Comprehensive reference for all primitive components in the Zabir Boutiques storefront.

## Table of Contents

1. [Button](#button)
2. [Input](#input)
3. [Select](#select)
4. [Badge](#badge)
5. [Modal](#modal)
6. [Toast](#toast)
7. [Spinner](#spinner)

---

## Button

Primary interactive component for user actions.

**Location:** `src/components/primitives/Button.astro`

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'primary' \| 'secondary' \| 'danger' \| 'ghost'` | `'primary'` | Button style variant |
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Button size |
| `loading` | `boolean` | `false` | Show loading spinner |
| `disabled` | `boolean` | `false` | Disable button |
| `type` | `'button' \| 'submit' \| 'reset'` | `'button'` | Button type attribute |
| `href` | `string` | `undefined` | Convert to link element |
| `class` | `string` | `''` | Additional CSS classes |
| `id` | `string` | `undefined` | Button ID |
| `...rest` | `any` | — | Any valid HTML button attributes |

### Variants

#### Primary (Default)
```astro
<Button>Click me</Button>
```
- Red brand color background
- White text
- Darkens on hover
- Default for main actions (Add to Cart, Checkout, etc.)

#### Secondary
```astro
<Button variant="secondary">Secondary Action</Button>
```
- White/surface background with border
- Dark text
- Light gray background on hover
- For secondary/alternative actions

#### Danger
```astro
<Button variant="danger">Delete</Button>
```
- Red background
- White text
- For destructive actions (delete, remove, cancel)

#### Ghost
```astro
<Button variant="ghost">Skip</Button>
```
- No background, text only
- Muted color by default
- For tertiary actions or links

### Sizes

| Size | Height | Padding | Font Size |
|------|--------|---------|-----------|
| `sm` | 36px (h-9) | px-3.5 py-1.5 | 12px |
| `md` | 44px (h-11) | px-5 py-2 | 14px |
| `lg` | 56px (h-14) | px-7 py-2.5 | 16px |

### States

#### Normal
```astro
<Button>Normal State</Button>
```

#### Loading
```astro
<Button loading>Loading...</Button>
```
- Shows spinner icon
- Text appears faded (70% opacity)
- Button remains interactive but shows loading state

#### Disabled
```astro
<Button disabled>Disabled</Button>
```
- 40% opacity
- Cannot be clicked
- Cursor shows "not-allowed"

#### Focus (Keyboard Navigation)
- 3px ring around button using brand color
- Visible focus ring for accessibility
- Works with Tab key

### Examples

```astro
---
import Button from "@/components/primitives/Button.astro";
---

<!-- Primary button -->
<Button>Add to Cart</Button>

<!-- Secondary with size -->
<Button variant="secondary" size="lg">Learn More</Button>

<!-- Danger action -->
<Button variant="danger" size="sm" onclick="confirmDelete()">
  Remove
</Button>

<!-- Loading state -->
<Button loading>Processing...</Button>

<!-- As a link -->
<Button href="/checkout">Go to Checkout</Button>

<!-- Custom ID and classes -->
<Button id="submit-btn" class="w-full">Submit Order</Button>
```

### Accessibility

- ✅ Keyboard navigable (Tab key)
- ✅ Focus ring visible (3px brand color)
- ✅ 44px minimum tap target on mobile
- ✅ Semantic `<button>` element
- ✅ Proper `aria-label` support for icon-only buttons
- ✅ Respects `prefers-reduced-motion` (no animation)

### CSS Classes Used

- Base: `inline-flex items-center justify-center font-semibold rounded-xl`
- Focus: `focus-visible:ring-3 focus-visible:ring-[var(--brand-glow)]`
- Disabled: `disabled:opacity-40 disabled:cursor-not-allowed`
- Touch: `tap-44` (minimum 44px tap target)

---

## Input

Text input for user data entry.

**Location:** `src/components/primitives/Input.astro`

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | Required | Visible label text |
| `name` | `string` | Required | Input name attribute |
| `type` | Input type | `'text'` | Input type (text, email, password, etc.) |
| `placeholder` | `string` | `undefined` | Placeholder text |
| `required` | `boolean` | `false` | Required field indicator |
| `error` | `string` | `undefined` | Error message (shows in red) |
| `hint` | `string` | `undefined` | Helper text below input |
| `maxLength` | `number` | `undefined` | Max character length |
| `value` | `string` | `undefined` | Initial value |
| `class` | `string` | `''` | Additional CSS classes |
| `...rest` | `any` | — | Any valid HTML input attributes |

### Supported Input Types

```
'text', 'number', 'email', 'password', 'search', 
'url', 'tel', 'date', 'time', 'file', 'hidden'
```

### Examples

```astro
---
import Input from "@/components/primitives/Input.astro";
---

<!-- Basic text input -->
<Input name="name" label="Full Name" />

<!-- With placeholder -->
<Input 
  name="email" 
  label="Email Address" 
  type="email"
  placeholder="you@example.com" 
/>

<!-- Password field -->
<Input 
  name="password" 
  label="Password" 
  type="password" 
  required 
/>

<!-- With error message -->
<Input 
  name="email" 
  label="Email"
  type="email"
  error="Please enter a valid email address"
/>

<!-- With hint text -->
<Input 
  name="username" 
  label="Username" 
  hint="3-20 characters, alphanumeric only"
/>

<!-- Phone number (16px font on iOS to prevent zoom) -->
<Input 
  name="phone" 
  label="Phone Number"
  type="tel"
  placeholder="+880..."
/>

<!-- Number input -->
<Input 
  name="quantity" 
  label="Quantity"
  type="number"
  min="1"
  max="100"
/>

<!-- File upload -->
<Input 
  name="image" 
  label="Upload Image"
  type="file"
  accept="image/*"
/>
```

### Styling

#### Label
- Font size: 12px (xs)
- Font weight: 600 (semibold)
- Color: Muted secondary text
- Uppercase with wide letter-spacing
- Red asterisk for required fields (visually hidden from screen readers)

#### Input Field
- Height: 44px (h-11) - minimum touch target
- Padding: 16px (px-4)
- Border radius: 12px (rounded-xl)
- Border: 1px solid (--border-storefront)
- Focus: Brand color border with glow ring
- Error: Red border with red glow ring

#### Error Message
- Font size: 12px
- Color: Red (--danger-storefront)
- Includes alert icon
- Uses `aria-live="polite"` region

#### Hint Text
- Font size: 12px
- Color: Muted (--muted)
- Only shows when no error present

### States

#### Normal
```astro
<Input name="text" label="Text" />
```

#### Focus
```css
border: 1px solid var(--brand-storefront);
box-shadow: 0 0 0 3px var(--brand-storefront-glow);
```

#### Error
```css
border: 1px solid var(--danger-storefront);
box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.1);
```

### Accessibility

- ✅ Label properly linked via `for` attribute
- ✅ Error messages linked via `aria-describedby`
- ✅ `aria-invalid="true"` when error present
- ✅ Hint text linked for screen readers
- ✅ 16px font size on mobile (prevents iOS zoom)
- ✅ 44px minimum height (touch target)
- ✅ Semantic HTML

---

## Select

Dropdown for selecting from predefined options.

**Location:** `src/components/primitives/Select.astro`

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `label` | `string` | Required | Visible label text |
| `name` | `string` | Required | Select name attribute |
| `options` | `Option[]` | Required | Array of options to display |
| `required` | `boolean` | `false` | Required field |
| `error` | `string` | `undefined` | Error message |
| `value` | `string` | `undefined` | Currently selected value |
| `placeholder` | `string` | `undefined` | Placeholder option text |
| `class` | `string` | `''` | Additional CSS classes |
| `...rest` | `any` | — | Any valid HTML select attributes |

### Option Interface

```typescript
interface Option {
  value: string;      // Value to submit
  label: string;      // Display text
  disabled?: boolean; // Disable this option
}
```

### Examples

```astro
---
import Select from "@/components/primitives/Select.astro";

const deliveryMethods = [
  { value: 'standard', label: 'Standard Delivery (3-5 days)' },
  { value: 'express', label: 'Express Delivery (1-2 days)' },
  { value: 'overnight', label: 'Overnight Delivery' }
];

const paymentMethods = [
  { value: 'cod', label: 'Cash on Delivery' },
  { value: 'card', label: 'Credit/Debit Card' },
  { value: 'bkash', label: 'bKash' },
  { value: 'nagad', label: 'Nagad' }
];
---

<!-- Basic select -->
<Select 
  name="delivery"
  label="Delivery Method"
  options={deliveryMethods}
  placeholder="Choose delivery method"
/>

<!-- Required select -->
<Select 
  name="payment"
  label="Payment Method"
  options={paymentMethods}
  required
/>

<!-- With error -->
<Select 
  name="country"
  label="Shipping Country"
  options={countries}
  error="Please select a country"
/>

<!-- Disabled option -->
<Select 
  name="size"
  label="Size"
  options={[
    { value: 's', label: 'Small' },
    { value: 'm', label: 'Medium' },
    { value: 'l', label: 'Large', disabled: true }, // Out of stock
    { value: 'xl', label: 'Extra Large' }
  ]}
/>
```

### Keyboard Navigation

- ↓ / ↑ Arrow keys: Navigate options
- Enter: Select highlighted option
- Escape: Close dropdown (if custom)
- Tab: Move to next field
- Native `<select>` uses browser's native picker on mobile

### Accessibility

- ✅ Semantic `<select>` element
- ✅ Label linked via `for` attribute
- ✅ Error linked via `aria-describedby`
- ✅ `aria-invalid="true"` when error present
- ✅ Keyboard navigable with arrow keys
- ✅ Native browser dropdown on mobile (better UX)
- ✅ Screen reader accessible

---

## Badge

Status indicator and label component.

**Location:** `src/components/primitives/Badge.astro`

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'primary' \| 'accent' \| 'danger' \| 'success' \| 'warning' \| 'neutral'` | `'neutral'` | Badge style |
| `dismissible` | `boolean` | `false` | Show close button |
| `onclose` | `string` | `'this.parentElement.remove()'` | Close button action |
| `class` | `string` | `''` | Additional CSS classes |

### Variants

#### Primary
```astro
<Badge variant="primary">Primary</Badge>
```
- Dark red text on light red background
- For important labels (Featured, Sale, New)

#### Accent
```astro
<Badge variant="accent">Accent</Badge>
```
- Brand red text on light red background

#### Danger
```astro
<Badge variant="danger">Error</Badge>
```
- Red text on red background tint
- For errors, alerts

#### Success
```astro
<Badge variant="success">Confirmed</Badge>
```
- Green text on green background tint
- For success states

#### Warning
```astro
<Badge variant="warning">Caution</Badge>
```
- Amber text on amber background tint
- For warnings, alerts

#### Neutral (Default)
```astro
<Badge variant="neutral">Label</Badge>
```
- Gray text on gray background
- For generic labels

### Dismissible Badges

```astro
<Badge variant="success" dismissible>
  Promo Applied: SUMMER20
</Badge>
```
- Includes close (×) button
- Removes element on click
- Useful for applied filters, temporary notices

### Examples

```astro
---
import Badge from "@/components/primitives/Badge.astro";
---

<!-- Status badges -->
<Badge variant="success">In Stock</Badge>
<Badge variant="danger">Out of Stock</Badge>
<Badge variant="warning">Low Stock</Badge>

<!-- Feature badges -->
<Badge variant="primary">NEW ARRIVAL</Badge>
<Badge variant="accent">FEATURED</Badge>

<!-- Dismissible filter -->
<div class="flex gap-2">
  <Badge dismissible>Size: Medium</Badge>
  <Badge dismissible>Color: Red</Badge>
  <Badge dismissible>Price: Under 2000</Badge>
</div>

<!-- Stock indicator -->
<Badge variant={stockLevel < 5 ? 'warning' : 'success'}>
  {stockLevel < 5 ? `${stockLevel} left` : 'In Stock'}
</Badge>
```

### Color Contrast

- ✅ All variants meet WCAG AA (4.5:1 minimum)
- Light mode: Good contrast on light backgrounds
- Dark mode: Adjusted colors for dark backgrounds

### Accessibility

- ✅ Color + text for meaning (not color alone)
- ✅ Close button keyboard accessible (Tab, Enter)
- ✅ `aria-label` on close buttons
- ✅ Semantic `<span>` element

---

## Modal

Dialog box for focused user interaction.

**Location:** `src/components/primitives/Modal.astro`

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `id` | `string` | Required | Unique modal ID |
| `title` | `string` | Required | Modal heading |
| `class` | `string` | `''` | Additional CSS classes |

### Slots

| Slot | Purpose |
|------|---------|
| `default` | Modal body content |
| `footer` | Action buttons area |

### Examples

```astro
---
import Modal from "@/components/primitives/Modal.astro";
import Button from "@/components/primitives/Button.astro";
---

<!-- Basic modal -->
<Modal id="confirm-delete" title="Delete Item">
  Are you sure you want to delete this item? This action cannot be undone.
  
  <Fragment slot="footer">
    <Button variant="ghost" data-close-dialog="confirm-delete">
      Cancel
    </Button>
    <Button variant="danger">Delete</Button>
  </Fragment>
</Modal>

<!-- Newsletter signup -->
<Modal id="newsletter" title="Subscribe to Updates">
  <p>Get exclusive offers and updates delivered to your inbox.</p>
  
  <Input name="email" label="Email Address" type="email" required />
  
  <Fragment slot="footer">
    <Button variant="secondary" data-close-dialog="newsletter">
      Maybe Later
    </Button>
    <Button>Subscribe</Button>
  </Fragment>
</Modal>

<!-- Confirmation dialog -->
<Modal id="confirm-order" title="Confirm Order">
  <div class="space-y-3">
    <p>Order total: <strong>Tk. 5,299</strong></p>
    <p>Delivery to: <strong>Dhaka</strong></p>
    <p>Estimated delivery: <strong>2-3 days</strong></p>
  </div>
  
  <Fragment slot="footer">
    <Button variant="secondary" data-close-dialog="confirm-order">
      Edit Order
    </Button>
    <Button>Place Order</Button>
  </Fragment>
</Modal>
```

### Opening/Closing Modal

```html
<!-- Open modal (JavaScript) -->
<script>
  const modal = document.getElementById('confirm-delete');
  modal.showModal();
  
  // Close modal
  modal.close();
</script>

<!-- Close via button attribute -->
<button data-close-dialog="modal-id">Close</button>
```

### Features

- ✅ Focus trap (Tab cycles through focusable elements)
- ✅ Escape key closes modal
- ✅ Click outside (backdrop) closes modal
- ✅ Smooth animations (pop entrance, fade-in backdrop)
- ✅ Restore focus to trigger element on close
- ✅ Semantic `<dialog>` element

### Styling

- Backdrop: Semi-transparent dark with blur effect
- Border: 1px solid subtle
- Shadow: Large drop shadow (lg)
- Corners: Rounded 24px
- Max width: 512px (32rem)
- Padding: 24px
- Responsive: Full width minus 32px on mobile

### Accessibility

- ✅ Focus trap implemented
- ✅ Escape key support
- ✅ Title linked via modal semantics
- ✅ Close button with `aria-label`
- ✅ `role="alertdialog"` for alerts
- ✅ Backdrop blur for reduced motion support

---

## Toast

Notification component for temporary messages.

**Location:** `src/components/primitives/Toast.astro`

### API

```javascript
window.showToast(message, variant, duration);
```

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `message` | `string` | Required | Toast message text |
| `variant` | `'success' \| 'error' \| 'info'` | `'info'` | Toast style |
| `duration` | `number` | `3000` | Auto-dismiss time (ms), 0 = no auto-dismiss |

### Examples

```astro
---
import Toast from "@/components/primitives/Toast.astro";
import Button from "@/components/primitives/Button.astro";
---

<!-- Include Toast once per layout -->
<Toast />

<!-- Usage in client code -->
<script>
  // Success notification
  window.showToast('Item added to cart', 'success', 3000);
  
  // Error notification
  window.showToast('Failed to process payment', 'error', 5000);
  
  // Info notification
  window.showToast('Order status updated', 'info', 3000);
  
  // Persistent notification (no auto-dismiss)
  window.showToast('Your session is about to expire', 'warning', 0);
</script>

<!-- Trigger from button -->
<Button onclick="window.showToast('Copied to clipboard', 'success', 2000)">
  Copy Link
</Button>
```

### Toast Variants

#### Success (Green)
```javascript
window.showToast('Order placed successfully!', 'success');
```
- Green checkmark icon
- Used for confirmations, successful actions

#### Error (Red)
```javascript
window.showToast('Payment failed. Please try again.', 'error');
```
- Red alert icon
- Used for errors, failures, warnings

#### Info (Blue)
```javascript
window.showToast('New message from seller', 'info');
```
- Info icon in brand color
- Used for general notifications, updates

### Features

- ✅ Auto-dismiss after duration (configurable)
- ✅ Close button to dismiss immediately
- ✅ Stacks up to 3 visible toasts
- ✅ Smooth pop animation on entrance
- ✅ Fade out animation on exit
- ✅ Glass morphism effect with backdrop blur
- ✅ Touch-friendly close button (44px minimum)
- ✅ `aria-live="polite"` for screen reader announcement

### Positioning

- Fixed position bottom-right corner
- 16px margin from edges
- Max width: 448px (28rem)
- Responsive width on mobile (100% - 32px)
- Respects safe-area-inset for notches

### Accessibility

- ✅ Announced to screen readers via `aria-live`
- ✅ Close button with `aria-label`
- ✅ Keyboard accessible (Tab to close button, Enter to close)
- ✅ Auto-dismiss configurable (respects user preferences)
- ✅ Respects `prefers-reduced-motion` (no animation)

---

## Spinner

Loading indicator component.

**Location:** `src/components/primitives/Spinner.astro`

### Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `size` | `'sm' \| 'md' \| 'lg'` | `'md'` | Spinner size |
| `variant` | `'inline' \| 'block'` | `'inline'` | Display type |
| `class` | `string` | `''` | Additional CSS classes |

### Sizes

| Size | Dimensions | Stroke |
|------|------------|--------|
| `sm` | 16px (h-4 w-4) | 3px |
| `md` | 24px (h-6 w-6) | 2.5px |
| `lg` | 32px (h-8 w-8) | 2px |

### Examples

```astro
---
import Spinner from "@/components/primitives/Spinner.astro";
---

<!-- Inline spinner (default) -->
<span>Loading... <Spinner size="sm" class="text-current" /></span>

<!-- Block spinner (centered) -->
<Spinner size="lg" variant="block" />

<!-- In button (with text) -->
<Button loading>
  <Spinner size="sm" />
  Processing...
</Button>

<!-- Custom color -->
<Spinner class="text-brand" size="md" />

<!-- Loading page overlay -->
<div class="flex items-center justify-center min-h-screen">
  <Spinner size="lg" variant="block" />
</div>
```

### Animations

- Continuous smooth rotation
- 0.8 second rotation duration
- Easing: linear
- Respects `prefers-reduced-motion` (stops animation)

### Accessibility

- ✅ `role="status"` semantic role
- ✅ `aria-label="Loading"` for screen readers
- ✅ Respects `prefers-reduced-motion` (no animation)

### Color Inheritance

The spinner inherits color from parent via `currentColor`:

```astro
<!-- Green spinner -->
<Spinner class="text-success" />

<!-- Brand color spinner -->
<Spinner class="text-brand" />

<!-- Red spinner -->
<Spinner class="text-danger" />
```

---

## Best Practices

### Button

✅ **DO:**
- Use `variant="primary"` for main actions
- Use `variant="secondary"` for alternatives
- Use `variant="danger"` only for destructive actions
- Show loading state during form submission
- Always provide accessible text
- Use appropriate size (larger on mobile)

❌ **DON'T:**
- Mix button variants in same context
- Use buttons for navigation (use links instead)
- Disable buttons without good reason
- Use button text that's too long (truncate or wrap)

### Input

✅ **DO:**
- Always include a label
- Use correct `type` for better mobile keyboard
- Provide helpful placeholder text
- Show validation errors near the field
- Use `hint` for additional guidance
- Set `required` for required fields

❌ **DON'T:**
- Rely on placeholder as label
- Hide error messages
- Use very long error messages
- Disable fields unnecessarily
- Change field type on focus

### Select

✅ **DO:**
- Use semantic `<select>` for best mobile experience
- Group related options
- Disable out-of-stock or invalid options
- Provide clear option labels
- Show errors clearly

❌ **DON'T:**
- Use custom dropdown unless absolutely necessary
- Hide selected value
- Have too many options (use search instead)
- Use confusing option labels

### Badge

✅ **DO:**
- Use appropriate variant for status
- Combine color with text (not color alone)
- Use for status, labels, tags
- Make dismissible for temporary notices

❌ **DON'T:**
- Overuse badges (clear hierarchy)
- Use for critical information alone (use toast instead)
- Use conflicting colors together

### Modal

✅ **DO:**
- Use for focused interactions
- Provide clear title
- Include cancel option
- Use Escape to close
- Return focus to trigger

❌ **DON'T:**
- Use for forms (use page instead)
- Have nested modals
- Use for non-critical information
- Make hard to close

### Toast

✅ **DO:**
- Use for temporary, non-critical information
- Keep messages brief
- Use appropriate variant (success/error/info)
- Provide close button
- Set reasonable duration

❌ **DON'T:**
- Show for critical errors (use modal instead)
- Show multiple toasts for same event
- Use for form errors (show inline instead)
- Make toast hard to dismiss

### Spinner

✅ **DO:**
- Show during loading states
- Use appropriate size for context
- Combine with text
- Respect `prefers-reduced-motion`

❌ **DON'T:**
- Use as decoration
- Show indefinitely without context
- Make too small to see (minimum sm: 16px)

---

## Testing Components

### Manual Testing Checklist

- [ ] All variants render correctly
- [ ] All sizes display properly
- [ ] States (hover, focus, active, disabled) work
- [ ] Focus rings are visible
- [ ] Keyboard navigation works (Tab, Arrow, Enter, Escape)
- [ ] Screen reader announces content correctly
- [ ] Touch targets are at least 44px
- [ ] Animations respect `prefers-reduced-motion`
- [ ] Colors meet WCAG AA contrast (4.5:1)
- [ ] Mobile view (< 640px) displays correctly
- [ ] Dark mode colors are readable

### Browser Testing

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- Mobile Safari (iOS)
- Chrome Mobile (Android)

### Accessibility Testing

```bash
# Use axe DevTools extension
# Test each component for:
# - Color contrast
# - Focus visibility
# - Keyboard navigation
# - Screen reader announcements
# - ARIA attributes
```

---

## Component Status

| Component | Status | Variants | Notes |
|-----------|--------|----------|-------|
| Button | ✅ Complete | 4 (primary, secondary, danger, ghost) | Includes loading state |
| Input | ✅ Complete | 10+ input types | With error & hint support |
| Select | ✅ Complete | Semantic `<select>` | Mobile native picker |
| Badge | ✅ Complete | 6 (primary, accent, danger, success, warning, neutral) | Dismissible support |
| Modal | ✅ Complete | — | Focus trap, Esc to close |
| Toast | ✅ Complete | 3 (success, error, info) | Auto-dismiss, stacking |
| Spinner | ✅ Complete | 3 (sm, md, lg) | Respects reduced motion |

---

## Import Examples

```astro
---
import Button from "@/components/primitives/Button.astro";
import Input from "@/components/primitives/Input.astro";
import Select from "@/components/primitives/Select.astro";
import Badge from "@/components/primitives/Badge.astro";
import Modal from "@/components/primitives/Modal.astro";
import Toast from "@/components/primitives/Toast.astro";
import Spinner from "@/components/primitives/Spinner.astro";
---
```

For detailed design system documentation, see [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md)

