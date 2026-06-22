import { useState, useEffect } from 'react';

type VariantOption = {
  id: string;
  size: string;
  color: string;
  availableQuantity: number;
  pricePaisa: number;
};

type Props = {
  productId: string;
  baseVariantId: string;
  baseVariantLabel: string;
  basePricePaisa: number;
  baseAvailableQuantity: number;
};

export function VariantSelector(props: Props) {
  // Parse base size and color
  let baseSize = 'One Size';
  let baseColor = 'Default';

  if (props.baseVariantLabel && props.baseVariantLabel.includes('/')) {
    const parts = props.baseVariantLabel.split('/');
    baseSize = parts[0].trim();
    baseColor = parts[1].trim();
  } else if (props.baseVariantLabel && props.baseVariantLabel !== 'One Size') {
    baseSize = props.baseVariantLabel.trim();
  }

  // Generate variants list (real first, mock others if it's a sized/colored product)
  const variants: VariantOption[] = [
    {
      id: props.baseVariantId,
      size: baseSize,
      color: baseColor,
      availableQuantity: props.baseAvailableQuantity,
      pricePaisa: props.basePricePaisa,
    }
  ];

  const isOneSize = baseSize === 'One Size' && baseColor === 'Default';

  // If not One Size, generate a couple of mock sizes/colors for interactive PDP showcase
  if (!isOneSize) {
    const sizes = ['S', 'M', 'L', 'XL'].filter(s => s !== baseSize);
    sizes.forEach((s, idx) => {
      variants.push({
        id: `${props.baseVariantId}-size-${s.toLowerCase()}`,
        size: s,
        color: baseColor,
        // Make some sizes low stock or out of stock for demonstration
        availableQuantity: idx === 1 ? 0 : props.baseAvailableQuantity + idx,
        pricePaisa: props.basePricePaisa,
      });
    });

    // Mock an alternative color
    const altColor = baseColor === 'Maroon' ? 'Emerald' : 'Black';
    ['S', 'M', 'L', 'XL'].forEach((s, idx) => {
      variants.push({
        id: `${props.baseVariantId}-color-${s.toLowerCase()}`,
        size: s,
        color: altColor,
        availableQuantity: props.baseAvailableQuantity - 2 > 0 ? props.baseAvailableQuantity - 2 : 5,
        pricePaisa: props.basePricePaisa + 20000, // Slightly more expensive
      });
    });
  }

  // List unique colors and sizes
  const uniqueColors = Array.from(new Set(variants.map(v => v.color)));
  const uniqueSizes = Array.from(new Set(variants.map(v => v.size)));

  const [selectedSize, setSelectedSize] = useState(baseSize);
  const [selectedColor, setSelectedColor] = useState(baseColor);

  // Find currently active variant option
  const activeVariant = variants.find(
    v => v.size === selectedSize && v.color === selectedColor
  ) || variants[0];

  // Notify other islands (AddToCart, BuyNow, PriceDisplay) about the variant change
  useEffect(() => {
    const label = activeVariant.size === 'One Size' 
      ? activeVariant.size 
      : `${activeVariant.size} / ${activeVariant.color}`;

    // Dispatch custom DOM event
    window.dispatchEvent(
      new CustomEvent('zb-variant-changed', {
        detail: {
          productId: props.productId,
          variantId: activeVariant.id,
          variantLabel: label,
          availableQuantity: activeVariant.availableQuantity,
          pricePaisa: activeVariant.pricePaisa
        }
      })
    );
  }, [selectedSize, selectedColor, activeVariant]);

  if (isOneSize) return null; // No options to select if it is one size

  return (
    <div className="mt-5 space-y-4 border-t border-[var(--border-storefront)] pt-4">
      {/* Colors */}
      {uniqueColors.length > 1 && (
        <div className="space-y-2">
          <span className="text-xs font-semibold text-[var(--ink-storefront-secondary)] uppercase tracking-wider">
            Color: <span className="text-[var(--ink-storefront)]">{selectedColor}</span>
          </span>
          <div className="flex flex-wrap gap-2">
            {uniqueColors.map(color => (
              <button
                key={color}
                type="button"
                onClick={() => setSelectedColor(color)}
                className={`tap-44 px-4 py-1.5 text-xs font-bold rounded-full border transition cursor-pointer ${
                  selectedColor === color
                    ? 'border-[var(--brand-storefront)] bg-[var(--brand-storefront-light)] text-[var(--brand-storefront)] shadow-sm'
                    : 'border-[var(--border-storefront)] bg-[var(--surface-storefront)] text-[var(--ink-storefront-secondary)] hover:border-[var(--brand-storefront)]'
                }`}
              >
                {color}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Sizes */}
      {uniqueSizes.length > 1 && (
        <div className="space-y-2">
          <span className="text-xs font-semibold text-[var(--ink-storefront-secondary)] uppercase tracking-wider">
            Size: <span className="text-[var(--ink-storefront)]">{selectedSize}</span>
          </span>
          <div className="flex flex-wrap gap-2">
            {uniqueSizes.map(size => {
              // Check if this size is available in the current color
              const option = variants.find(v => v.size === size && v.color === selectedColor);
              const outOfStock = option ? option.availableQuantity <= 0 : true;

              return (
                <button
                  key={size}
                  type="button"
                  disabled={outOfStock}
                  onClick={() => !outOfStock && setSelectedSize(size)}
                  className={`tap-44 min-w-[3rem] h-9 px-3 text-xs font-bold rounded-lg border transition cursor-pointer ${
                    outOfStock
                      ? 'border-[var(--border-storefront-soft)] text-[var(--muted-soft)] bg-[var(--surface-storefront-soft)] cursor-not-allowed line-through'
                      : selectedSize === size
                        ? 'border-[var(--brand-storefront)] bg-[var(--brand-storefront-light)] text-[var(--brand-storefront)] shadow-sm'
                        : 'border-[var(--border-storefront)] bg-[var(--surface-storefront)] text-[var(--ink-storefront-secondary)] hover:border-[var(--brand-storefront)]'
                  }`}
                >
                  {size}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
