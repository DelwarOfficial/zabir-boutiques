// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AddToCartButton } from '../src/islands/AddToCartButton';

const mockAddItem = vi.fn();
const mockUpdateQuantity = vi.fn();
const mockClear = vi.fn();
const mockUseLocalCart = vi.fn(() => ({
  items: [],
  itemCount: 0,
  subtotalPaisa: 0,
  addItem: mockAddItem,
  updateQuantity: mockUpdateQuantity,
  clear: mockClear,
}));

vi.mock('../src/hooks/useLocalCart', () => ({
  useLocalCart: () => mockUseLocalCart(),
}));

const baseProps = {
  productId: 'prod-1',
  variantId: 'var-1',
  title: 'Test Product',
  imageUrl: '/test.jpg',
  variantLabel: 'Red / M',
  unitPricePaisa: 50000 as any,
  availableQuantity: 10,
};

beforeEach(() => {
  vi.useFakeTimers();
  mockUseLocalCart.mockReturnValue({
    items: [],
    itemCount: 0,
    subtotalPaisa: 0,
    addItem: mockAddItem,
    updateQuantity: mockUpdateQuantity,
    clear: mockClear,
  });
  mockAddItem.mockClear();
  mockUpdateQuantity.mockClear();
  mockClear.mockClear();
  Object.defineProperty(navigator, 'vibrate', {
    value: vi.fn(),
    configurable: true,
  });
  (window as any).showToast = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('AddToCartButton', () => {
  it('renders Add to cart button with props', () => {
    render(<AddToCartButton {...baseProps} />);
    expect(screen.getByRole('button')).toBeTruthy();
    expect(screen.getByText('Add to cart')).toBeTruthy();
  });

  it('shows Out of stock when availableQuantity is 0', () => {
    render(<AddToCartButton {...baseProps} availableQuantity={0} />);
    expect(screen.getByText('Out of stock')).toBeTruthy();
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('calls cart.addItem on click', () => {
    render(<AddToCartButton {...baseProps} />);
    fireEvent.click(screen.getByRole('button'));
    expect(mockAddItem).toHaveBeenCalledWith({
      productId: 'prod-1',
      variantId: 'var-1',
      title: 'Test Product',
      imageUrl: '/test.jpg',
      variantLabel: 'Red / M',
      unitPricePaisa: 50000,
      quantity: 1,
      availableQuantity: 10,
    });
  });

  it('shows Added state after click', () => {
    render(<AddToCartButton {...baseProps} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Added')).toBeTruthy();
  });

  it('reverts from Added state after 1400ms', () => {
    render(<AddToCartButton {...baseProps} />);
    fireEvent.click(screen.getByRole('button'));
    act(() => { vi.advanceTimersByTime(1500); });
    expect(screen.getByText('Add to cart')).toBeTruthy();
  });

  it('does nothing when disabled and clicked', () => {
    render(<AddToCartButton {...baseProps} availableQuantity={0} />);
    fireEvent.click(screen.getByRole('button'));
    expect(mockAddItem).not.toHaveBeenCalled();
  });

  it('renders sticky variant', () => {
    render(<AddToCartButton {...baseProps} variant="sticky" />);
    expect(screen.getByText('Add to cart')).toBeTruthy();
  });

  it('updates active variant on zb-variant-changed event', () => {
    render(<AddToCartButton {...baseProps} />);
    fireEvent.click(screen.getByRole('button'));
    expect(mockAddItem).toHaveBeenCalledWith(expect.objectContaining({ variantId: 'var-1' }));
    act(() => {
      window.dispatchEvent(new CustomEvent('zb-variant-changed', {
        detail: {
          productId: 'prod-1',
          variantId: 'var-2',
          variantLabel: 'Blue / L',
          availableQuantity: 5,
          pricePaisa: 60000,
        },
      }));
    });
    fireEvent.click(screen.getByRole('button'));
    expect(mockAddItem).toHaveBeenCalledWith(expect.objectContaining({
      variantId: 'var-2',
      unitPricePaisa: 60000,
    }));
  });

  it('calls showToast on add', () => {
    render(<AddToCartButton {...baseProps} />);
    fireEvent.click(screen.getByRole('button'));
    expect((window as any).showToast).toHaveBeenCalled();
  });
});
