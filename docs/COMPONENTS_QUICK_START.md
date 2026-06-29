# Components Quick Start Guide

Fast reference for implementing primitive components in the storefront.

## Import Pattern

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

---

## Common Patterns

### Form with Validation

```astro
---
import Input from "@/components/primitives/Input.astro";
import Button from "@/components/primitives/Button.astro";
---

<form>
  <Input 
    name="email" 
    label="Email Address" 
    type="email" 
    required 
    placeholder="you@example.com"
  />
  
  <Input 
    name="password" 
    label="Password" 
    type="password" 
    required 
    hint="At least 8 characters"
  />
  
  <Button type="submit">Sign In</Button>
</form>
```

### Checkout Flow

```astro
---
import Input from "@/components/primitives/Input.astro";
import Select from "@/components/primitives/Select.astro";
import Button from "@/components/primitives/Button.astro";
---

<div class="space-y-6">
  <!-- Address Section -->
  <div>
    <h2 class="text-lg font-semibold mb-4">Delivery Address</h2>
    
    <Select 
      name="area"
      label="Area/District"
      options={areas}
      required
    />
    
    <Input 
      name="address" 
      label="Full Address" 
      required
      hint="Street, building, apartment number"
    />
    
    <Input 
      name="landmark" 
      label="Landmark" 
      hint="Optional: nearby landmark for easier delivery"
    />
  </div>
  
  <!-- Payment Section -->
  <div>
    <h2 class="text-lg font-semibold mb-4">Payment Method</h2>
    
    <Select 
      name="payment"
      label="Choose Payment Method"
      options={[
        { value: 'cod', label: 'Cash on Delivery' },
        { value: 'card', label: 'Credit/Debit Card' },
        { value: 'bkash', label: 'bKash' }
      ]}
      required
    />
  </div>
  
  <Button type="submit" size="lg">Place Order</Button>
</div>
```

### Modal Confirmation

```astro
---
import Modal from "@/components/primitives/Modal.astro";
import Button from "@/components/primitives/Button.astro";
---

<!-- Modal -->
<Modal id="delete-modal" title="Delete Item">
  <p>Are you sure you want to delete this item? This action cannot be undone.</p>
  
  <Fragment slot="footer">
    <Button variant="secondary" data-close-dialog="delete-modal">
      Cancel
    </Button>
    <Button variant="danger" onclick="deleteItem()">Delete</Button>
  </Fragment>
</Modal>

<!-- Trigger -->
<Button 
  variant="ghost" 
  onclick="document.getElementById('delete-modal').showModal()"
>
  Delete
</Button>
```

### Status Badges

```astro
---
import Badge from "@/components/primitives/Badge.astro";
---

<!-- Stock status -->
{stockLevel === 0 && (
  <Badge variant="danger">Sold Out</Badge>
)}
{stockLevel < 5 && stockLevel > 0 && (
  <Badge variant="warning">{stockLevel} Left</Badge>
)}
{stockLevel >= 5 && (
  <Badge variant="success">In Stock</Badge>
)}

<!-- Feature badges -->
<Badge variant="primary">NEW</Badge>
<Badge variant="accent">FEATURED</Badge>
```

### Loading States

```astro
---
import Button from "@/components/primitives/Button.astro";
import Spinner from "@/components/primitives/Spinner.astro";
---

<!-- Button with loading -->
<Button loading>Processing...</Button>

<!-- Inline loading -->
<span class="flex items-center gap-2">
  Loading orders
  <Spinner size="sm" class="text-brand" />
</span>

<!-- Page loading -->
<div class="flex items-center justify-center min-h-screen">
  <Spinner size="lg" variant="block" />
</div>
```

### Toast Notifications

```astro
---
import Toast from "@/components/primitives/Toast.astro";
import Button from "@/components/primitives/Button.astro";
---

<!-- Include once per layout -->
<Toast />

<!-- Trigger toasts -->
<Button onclick="window.showToast('Item added to cart', 'success')">
  Add to Cart
</Button>

<Button onclick="window.showToast('Payment failed', 'error', 5000)">
  Try Payment
</Button>

<Button onclick="window.showToast('Order updated', 'info')">
  Check Status
</Button>
```

### Button Group

```astro
---
import Button from "@/components/primitives/Button.astro";
---

<!-- Primary + Secondary -->
<div class="flex gap-3">
  <Button variant="secondary" class="flex-1">Cancel</Button>
  <Button class="flex-1">Confirm</Button>
</div>

<!-- Multiple actions -->
<div class="flex gap-2">
  <Button variant="ghost" size="sm">Skip</Button>
  <Button variant="secondary" size="sm">Back</Button>
  <Button size="sm">Next</Button>
</div>

<!-- Destructive -->
<div class="flex gap-3">
  <Button variant="secondary" class="flex-1">Keep</Button>
  <Button variant="danger" class="flex-1">Delete</Button>
</div>
```

### Input with Error

```astro
---
import Input from "@/components/primitives/Input.astro";
import Button from "@/components/primitives/Button.astro";
---

<form>
  <Input 
    name="email"
    label="Email"
    type="email"
    error={emailError ? "Invalid email address" : undefined}
    required
  />
  
  <Input 
    name="password"
    label="Password"
    type="password"
    error={passwordError ? "Incorrect password" : undefined}
    required
  />
  
  <Button type="submit">Sign In</Button>
</form>
```

### Responsive Grid

```astro
---
import Button from "@/components/primitives/Button.astro";
---

<!-- Responsive button layout -->
<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
  <Button variant="secondary">Option 1</Button>
  <Button variant="secondary">Option 2</Button>
  <Button variant="secondary">Option 3</Button>
  <Button>Select</Button>
</div>

<!-- Mobile stacked, desktop side-by-side -->
<div class="flex flex-col sm:flex-row gap-3">
  <Button variant="secondary" class="flex-1">Cancel</Button>
  <Button class="flex-1">Confirm</Button>
</div>
```

---

## Props Quick Reference

### Button
```astro
<Button 
  variant="primary|secondary|danger|ghost"
  size="sm|md|lg"
  loading={boolean}
  disabled={boolean}
  href={string}
  class={string}
>
  Text
</Button>
```

### Input
```astro
<Input 
  name={string}
  label={string}
  type="text|email|password|tel|number|..."
  required={boolean}
  error={string}
  hint={string}
  maxLength={number}
  class={string}
/>
```

### Select
```astro
<Select 
  name={string}
  label={string}
  options={Option[]}
  required={boolean}
  error={string}
  value={string}
  placeholder={string}
  class={string}
/>
```

### Badge
```astro
<Badge 
  variant="primary|accent|danger|success|warning|neutral"
  dismissible={boolean}
  onclose={string}
  class={string}
>
  Text
</Badge>
```

### Modal
```astro
<Modal 
  id={string}
  title={string}
  class={string}
>
  Content
  <Fragment slot="footer">
    Footer buttons
  </Fragment>
</Modal>
```

### Toast
```javascript
window.showToast(
  message: string,
  variant: 'success|error|info',  // default: 'info'
  duration: number                // default: 3000 (0 = no auto-dismiss)
);
```

### Spinner
```astro
<Spinner 
  size="sm|md|lg"
  variant="inline|block"
  class={string}
/>
```

---

## Accessibility Checklist

- [ ] Buttons have visible focus ring
- [ ] Labels associated with inputs (via `for` attribute)
- [ ] Error messages linked via `aria-describedby`
- [ ] Touch targets are 44px minimum
- [ ] Color not used alone for meaning
- [ ] Keyboard navigation works (Tab, Enter, Arrow, Escape)
- [ ] Screen reader can announce content
- [ ] Animations respect `prefers-reduced-motion`
- [ ] Focus order is logical
- [ ] No keyboard traps (except modal)

---

## Styling & Customization

All components use design tokens and Tailwind classes. Customize via:

### Via CSS Variables
```css
:root {
  --brand-storefront: #bc1545;        /* Change brand color */
  --surface-storefront: #ffffff;      /* Change surface */
  --radius-storefront-md: 0.75rem;    /* Change border radius */
}
```

### Via Tailwind Classes
```astro
<Button class="w-full">Full width button</Button>
<Input class="mb-4">Extra margin</Input>
```

### Via Component Variants
```astro
<Button variant="danger">Destructive</Button>
<Badge variant="success">Success</Badge>
```

---

## Common Issues

### Focus Ring Not Visible
**Solution:** Check that `focus-visible` CSS isn't overridden. The components use `focus-visible:ring-3` which should always be visible.

### Button Text Overflowing
**Solution:** Use `class="w-full"` on buttons or wrap in flex container with proper gap.

### Modal Not Appearing
**Solution:** Call `showModal()` on the dialog element:
```javascript
document.getElementById('my-modal').showModal();
```

### Toast Not Showing
**Solution:** Ensure `<Toast />` is included in your layout, and call:
```javascript
window.showToast('Message', 'success');
```

### Input 16px Font Not Applied
**Solution:** The Input component already applies 16px font via Tailwind classes. If overridden, revert to `text-base`.

---

## Browser Support

All components work in:
- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+
- Mobile Safari (iOS 14+)
- Chrome Mobile (Android 9+)

---

## Performance Tips

1. **Lazy Load Modals** - Include modal HTML but don't show until needed
2. **Batch Toasts** - Show one toast at a time instead of multiple
3. **Debounce Inputs** - Add `debounce` to handle rapid changes
4. **Minimize Spinners** - Use small spinners for status, large for page loading

---

## See Also

- [Full Component API Reference](./COMPONENTS_API.md)
- [Design System Guide](./DESIGN_SYSTEM.md)
- [Accessibility Guidelines](./ACCESSIBILITY.md) (coming soon)

---

**For detailed documentation, see COMPONENTS_API.md**

