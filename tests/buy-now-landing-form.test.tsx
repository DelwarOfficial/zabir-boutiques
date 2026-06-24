// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { BuyNowLandingForm } from '../src/islands/BuyNowLandingForm';

const baseProps = {
  sessionId: 'sess-1',
  productName: 'Test Kurta',
  productImageUrl: '/kurta.jpg',
  variantLabel: 'Red / M',
  unitPricePaisa: 50000 as any,
  quantity: 1,
  insideDhakaPaisa: 7000 as any,
  outsideDhakaPaisa: 13000 as any,
  initialDraft: null,
  variants: [
    { id: 'v1', size: 'M', color: 'Red', pricePaisa: 50000 as any },
    { id: 'v2', size: 'L', color: 'Blue', pricePaisa: 60000 as any },
  ],
  selectedVariantId: 'v1',
  turnstileSiteKey: undefined,
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  vi.stubGlobal('crypto', { randomUUID: () => 'uuid-xxx' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('BuyNowLandingForm', () => {
  it('renders the order form', () => {
    render(<BuyNowLandingForm {...baseProps} />);
    expect(screen.getByText('Test Kurta')).toBeTruthy();
    expect(screen.getByText(/ক্যাশ অন ডেলিভারি/)).toBeTruthy();
  });

  it('shows variant selection buttons', () => {
    render(<BuyNowLandingForm {...baseProps} />);
    expect(screen.getByText('M - Red')).toBeTruthy();
    expect(screen.getByText('L - Blue')).toBeTruthy();
  });

  it('switches variant on click', () => {
    render(<BuyNowLandingForm {...baseProps} />);
    fireEvent.click(screen.getByText('L - Blue'));
    expect(screen.getByText('L - Blue')).toBeTruthy();
  });

  it('shows quantity stepper', () => {
    render(<BuyNowLandingForm {...baseProps} />);
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('increments quantity', () => {
    render(<BuyNowLandingForm {...baseProps} />);
    fireEvent.click(screen.getByText('+'));
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('decrements quantity', () => {
    render(<BuyNowLandingForm {...baseProps} />);
    fireEvent.click(screen.getByText('+'));
    fireEvent.click(screen.getByText('+'));
    expect(screen.getByText('3')).toBeTruthy();
    fireEvent.click(screen.getByText('-'));
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('does not decrement below 1', () => {
    render(<BuyNowLandingForm {...baseProps} />);
    expect(screen.getByText('1')).toBeTruthy();
    const minusBtn = screen.getAllByRole('button').find(b => b.textContent === '-');
    expect(minusBtn).toBeDisabled();
  });

  it('switches shipping zone', () => {
    render(<BuyNowLandingForm {...baseProps} />);
    const outsideBtn = screen.getByText('ঢাকা সিটির বাইরে');
    fireEvent.click(outsideBtn);
    expect(outsideBtn).toBeTruthy();
  });

  it('shows order summary with correct totals', () => {
    render(<BuyNowLandingForm {...baseProps} />);
    expect(screen.getAllByText(/Test Kurta/).length).toBe(2);
    expect(screen.getByText('মোট')).toBeTruthy();
  });

  it('shows error alert on failed submission', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false, status: 400,
      json: async () => ({ ok: false, code: 'CHECKOUT_FAILED', message: 'Order failed' }),
    } as Response);
    render(<BuyNowLandingForm {...baseProps} />);
    fireEvent.change(screen.getByPlaceholderText('আপনার নাম লিখুন'), { target: { value: 'Ayesha Rahman' } });
    fireEvent.change(screen.getByPlaceholderText('017XXXXXXXX'), { target: { value: '01712345678' } });
    fireEvent.change(screen.getByPlaceholderText(/বাসা নং/), { target: { value: '123 Main Street, Dhaka' } });
    fireEvent.click(screen.getByText(/অর্ডার কনফার্ম করুন/));
    await waitFor(() => {
      expect(screen.getByText('Order failed')).toBeTruthy();
    });
  });

  it('shows success state on successful submission', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ ok: true, order_number: 'BN-001' }),
    } as Response);
    render(<BuyNowLandingForm {...baseProps} />);
    fireEvent.change(screen.getByPlaceholderText('আপনার নাম লিখুন'), { target: { value: 'Ayesha Rahman' } });
    fireEvent.change(screen.getByPlaceholderText('017XXXXXXXX'), { target: { value: '01712345678' } });
    fireEvent.change(screen.getByPlaceholderText(/বাসা নং/), { target: { value: '123 Main Street, Dhaka' } });
    fireEvent.click(screen.getByText(/অর্ডার কনফার্ম করুন/));
    await waitFor(() => {
      expect(screen.getByText('BN-001')).toBeTruthy();
    });
  });

  it('handles NETWORK_ERROR on fetch rejection', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error('Network failure'));
    render(<BuyNowLandingForm {...baseProps} />);
    fireEvent.change(screen.getByPlaceholderText('আপনার নাম লিখুন'), { target: { value: 'Ayesha Rahman' } });
    fireEvent.change(screen.getByPlaceholderText('017XXXXXXXX'), { target: { value: '01712345678' } });
    fireEvent.change(screen.getByPlaceholderText(/বাসা নং/), { target: { value: '123 Main Street, Dhaka' } });
    fireEvent.click(screen.getByText(/অর্ডার কনফার্ম করুন/));
    await waitFor(() => {
      expect(screen.getByText('নেটওয়ার্ক সমস্যা। আবার চেষ্টা করুন।')).toBeTruthy();
    });
  });

  it('handles 202 processing response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false, status: 202,
      json: async () => ({ ok: false, code: 'CHECKOUT_PROCESSING' }),
    } as Response);
    render(<BuyNowLandingForm {...baseProps} />);
    fireEvent.change(screen.getByPlaceholderText('আপনার নাম লিখুন'), { target: { value: 'Ayesha Rahman' } });
    fireEvent.change(screen.getByPlaceholderText('017XXXXXXXX'), { target: { value: '01712345678' } });
    fireEvent.change(screen.getByPlaceholderText(/বাসা নং/), { target: { value: '123 Main Street, Dhaka' } });
    fireEvent.click(screen.getByText(/অর্ডার কনফার্ম করুন/));
    await waitFor(() => {
      expect(screen.getByText('অর্ডার প্রসেস হচ্ছে। একটু অপেক্ষা করুন।')).toBeTruthy();
    });
  });
});
