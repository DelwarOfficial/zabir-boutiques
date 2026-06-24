// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GuestCheckout } from '../src/islands/GuestCheckout';

const mockAddItem = vi.fn();
const mockUpdateQuantity = vi.fn();
const mockClear = vi.fn();
let mockCartItems: any[] = [];

const mockUseLocalCart = vi.fn(() => ({
  items: mockCartItems,
  itemCount: mockCartItems.reduce((s: number, i: any) => s + i.quantity, 0),
  subtotalPaisa: mockCartItems.reduce((s: number, i: any) => s + i.unitPricePaisa * i.quantity, 0),
  addItem: mockAddItem,
  updateQuantity: mockUpdateQuantity,
  clear: mockClear,
}));

const mockReadCartSessionId = vi.fn(() => 'test-session-id');
const mockApplyOutOfStockUpdate = vi.fn();

vi.mock('../src/hooks/useLocalCart', () => ({
  useLocalCart: () => mockUseLocalCart(),
}));

vi.mock('../src/lib/cart-store', () => ({
  readCartSessionId: (...args: any[]) => mockReadCartSessionId(...args),
  applyOutOfStockUpdate: (...args: any[]) => mockApplyOutOfStockUpdate(...args),
  CART_STORAGE_KEY: 'zb_cart_v68a',
}));

beforeEach(() => {
  mockCartItems = [];
  mockUseLocalCart.mockClear();
  mockReadCartSessionId.mockClear();
  mockApplyOutOfStockUpdate.mockClear();
  mockAddItem.mockClear();
  mockClear.mockClear();
  vi.stubGlobal('fetch', vi.fn());
  vi.stubGlobal('crypto', { randomUUID: () => 'uuid-xxx' });
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function fillContact(container: HTMLElement) {
  fireEvent.change(screen.getByPlaceholderText('Ayesha Rahman'), { target: { value: 'Ayesha Rahman' } });
  fireEvent.change(screen.getByPlaceholderText('017XXXXXXXX'), { target: { value: '01712345678' } });
  fireEvent.click(screen.getByText('Continue'));
}

describe('GuestCheckout', () => {
  it('renders the guest checkout form', () => {
    render(<GuestCheckout />);
    expect(screen.getByText('Guest checkout')).toBeTruthy();
    expect(screen.getByText('Contact')).toBeTruthy();
  });

  it('shows empty cart message when no items', () => {
    render(<GuestCheckout />);
    expect(screen.getByText(/Your offline cart is empty/)).toBeTruthy();
  });

  it('renders cart items', () => {
    mockCartItems = [{
      variantId: 'v1', productId: 'p1', title: 'Item 1',
      imageUrl: '/img.jpg', variantLabel: 'Red', unitPricePaisa: 50000, quantity: 2, availableQuantity: 10,
    }];
    render(<GuestCheckout />);
    expect(screen.getByText('Item 1')).toBeTruthy();
    expect(screen.getByText('Red')).toBeTruthy();
  });

  it('navigates from contact step to delivery step', async () => {
    mockCartItems = [{
      variantId: 'v1', productId: 'p1', title: 'Item 1',
      imageUrl: '/img.jpg', variantLabel: 'Red', unitPricePaisa: 50000, quantity: 2, availableQuantity: 10,
    }];
    render(<GuestCheckout />);
    fireEvent.change(screen.getByPlaceholderText('Ayesha Rahman'), { target: { value: 'Ayesha Rahman' } });
    fireEvent.change(screen.getByPlaceholderText('017XXXXXXXX'), { target: { value: '01712345678' } });
    fireEvent.click(screen.getByText('Continue'));
    await waitFor(() => { expect(screen.getByText('Delivery')).toBeTruthy(); });
  });

  it('shows error alert on checkout failure', async () => {
    mockCartItems = [{
      variantId: 'v1', productId: 'p1', title: 'Item 1',
      imageUrl: '/img.jpg', variantLabel: 'Red', unitPricePaisa: 50000, quantity: 2, availableQuantity: 10,
    }];
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, code: 'CHECKOUT_FAILED', message: 'Checkout failed' }),
    } as Response);
    render(<GuestCheckout />);
    fireEvent.change(screen.getByPlaceholderText('Ayesha Rahman'), { target: { value: 'Ayesha Rahman' } });
    fireEvent.change(screen.getByPlaceholderText('017XXXXXXXX'), { target: { value: '01712345678' } });
    fireEvent.click(screen.getByText('Continue'));
    fireEvent.click(screen.getByText('Continue'));
    await waitFor(() => { expect(screen.getByText('Review')).toBeTruthy(); });
    fireEvent.click(screen.getByText(/Place Order/));
    await waitFor(() => { expect(screen.getByText('Checkout failed')).toBeTruthy(); });
  });

  it('shows success state on successful checkout', async () => {
    mockCartItems = [{
      variantId: 'v1', productId: 'p1', title: 'Item 1',
      imageUrl: '/img.jpg', variantLabel: 'Red', unitPricePaisa: 50000, quantity: 2, availableQuantity: 10,
    }];
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, order_number: 'ORD-001' }),
    } as Response);
    render(<GuestCheckout />);
    fireEvent.change(screen.getByPlaceholderText('Ayesha Rahman'), { target: { value: 'Ayesha Rahman' } });
    fireEvent.change(screen.getByPlaceholderText('017XXXXXXXX'), { target: { value: '01712345678' } });
    fireEvent.click(screen.getByText('Continue'));
    fireEvent.click(screen.getByText('Continue'));
    await waitFor(() => { expect(screen.getByText('Review')).toBeTruthy(); });
    fireEvent.click(screen.getByText(/Place Order/));
    await waitFor(() => {
      expect(screen.getByText('Order placed!')).toBeTruthy();
      expect(screen.getByText('ORD-001')).toBeTruthy();
    });
  });

  it('handles 402 PREPAYMENT_REQUIRED by retrying with partial_prepay', async () => {
    mockCartItems = [{
      variantId: 'v1', productId: 'p1', title: 'Item 1',
      imageUrl: '/img.jpg', variantLabel: 'Red', unitPricePaisa: 50000, quantity: 4, availableQuantity: 10,
    }];
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: false, status: 402,
        json: async () => ({ ok: false, code: 'PREPAYMENT_REQUIRED' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ ok: true, order_number: 'ORD-002', checkout_url: '/uddoktapay' }),
      } as Response);
    render(<GuestCheckout />);
    fireEvent.change(screen.getByPlaceholderText('Ayesha Rahman'), { target: { value: 'Ayesha Rahman' } });
    fireEvent.change(screen.getByPlaceholderText('017XXXXXXXX'), { target: { value: '01712345678' } });
    const textarea = screen.getByPlaceholderText('House, road, area, district');
    fireEvent.change(textarea, { target: { value: '123 Main Street, Dhaka' } });
    fireEvent.click(screen.getByText('Continue'));
    fireEvent.click(screen.getByText('Continue'));
    fireEvent.click(screen.getByText('Review'));
    await waitFor(() => { expect(screen.getByText(/Place Order/)).toBeTruthy(); });
    fireEvent.click(screen.getByText(/Place Order/));
    await waitFor(() => {
      expect(screen.getByText('Order placed!')).toBeTruthy();
      expect(screen.getByText('ORD-002')).toBeTruthy();
    });
  });

  it('shows prepayment warning when totalQuantity > 2 and COD', () => {
    mockCartItems = [{
      variantId: 'v1', productId: 'p1', title: 'Item 1',
      imageUrl: '/img.jpg', variantLabel: 'Red', unitPricePaisa: 50000, quantity: 3, availableQuantity: 10,
    }];
    render(<GuestCheckout />);
    expect(screen.getByText(/Orders with more than two items/)).toBeTruthy();
  });

  it('does not show prepayment warning for qty <= 2', () => {
    mockCartItems = [{
      variantId: 'v1', productId: 'p1', title: 'Item 1',
      imageUrl: '/img.jpg', variantLabel: 'Red', unitPricePaisa: 50000, quantity: 2, availableQuantity: 10,
    }];
    render(<GuestCheckout />);
    expect(screen.queryByText(/Orders with more than two items/)).toBeNull();
  });

  it('handles OUT_OF_STOCK response from server', async () => {
    mockCartItems = [{
      variantId: 'v1', productId: 'p1', title: 'Item 1',
      imageUrl: '/img.jpg', variantLabel: 'Red', unitPricePaisa: 50000, quantity: 2, availableQuantity: 10,
    }];
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false, status: 409,
      json: async () => ({
        ok: false, code: 'OUT_OF_STOCK', message: 'Item out of stock',
        failed_cart_index: 0, available_quantity: 0,
      }),
    } as Response);
    render(<GuestCheckout />);
    fireEvent.change(screen.getByPlaceholderText('Ayesha Rahman'), { target: { value: 'Ayesha Rahman' } });
    fireEvent.change(screen.getByPlaceholderText('017XXXXXXXX'), { target: { value: '01712345678' } });
    fireEvent.click(screen.getByText('Continue'));
    fireEvent.click(screen.getByText('Continue'));
    await waitFor(() => { expect(screen.getByText('Review')).toBeTruthy(); });
    fireEvent.click(screen.getByText(/Place Order/));
    await waitFor(() => {
      expect(mockApplyOutOfStockUpdate).toHaveBeenCalledWith('v1', 0);
    });
  });

  it('shows 202 processing message', async () => {
    mockCartItems = [{
      variantId: 'v1', productId: 'p1', title: 'Item 1',
      imageUrl: '/img.jpg', variantLabel: 'Red', unitPricePaisa: 50000, quantity: 2, availableQuantity: 10,
    }];
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false, status: 202,
      json: async () => ({ ok: false, code: 'CHECKOUT_PROCESSING', message: 'Your order is still processing' }),
    } as Response);
    render(<GuestCheckout />);
    fireEvent.change(screen.getByPlaceholderText('Ayesha Rahman'), { target: { value: 'Ayesha Rahman' } });
    fireEvent.change(screen.getByPlaceholderText('017XXXXXXXX'), { target: { value: '01712345678' } });
    fireEvent.click(screen.getByText('Continue'));
    fireEvent.click(screen.getByText('Continue'));
    await waitFor(() => { expect(screen.getByText('Review')).toBeTruthy(); });
    fireEvent.click(screen.getByText(/Place Order/));
    await waitFor(() => {
      expect(screen.getByText('Your order is still processing')).toBeTruthy();
    });
  });
});
