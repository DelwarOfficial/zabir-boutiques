import { describe, it, expect, vi } from 'vitest';
import { decideFraudRisk, deriveRiskScore, checkFraudBD } from '../src/lib/fraud';

describe('decideFraudRisk', () => {
  it('returns approved for score 0-30', () => {
    expect(decideFraudRisk(0)).toBe('approved');
    expect(decideFraudRisk(15)).toBe('approved');
    expect(decideFraudRisk(30)).toBe('approved');
  });

  it('returns review for score 31-79', () => {
    expect(decideFraudRisk(31)).toBe('review');
    expect(decideFraudRisk(50)).toBe('review');
    expect(decideFraudRisk(79)).toBe('review');
  });

  it('returns blocked for score 80-100', () => {
    expect(decideFraudRisk(80)).toBe('blocked');
    expect(decideFraudRisk(100)).toBe('blocked');
  });

  it('returns review for null score (timeout/error)', () => {
    expect(decideFraudRisk(null)).toBe('review');
  });
});

describe('deriveRiskScore (FraudBD Check Courier Info contract)', () => {
  it('returns null for non-success or empty payloads', () => {
    expect(deriveRiskScore(null)).toBeNull();
    expect(deriveRiskScore({ status: false })).toBeNull();
    expect(deriveRiskScore({ status: true })).toBeNull();
  });

  it('uses totalSummary.cancelRate as the delivery risk score', () => {
    const data = {
      status: true,
      data: { Summaries: {}, totalSummary: { total: 16, success: 13, cancel: 3, successRate: 81.25, cancelRate: 18.75 } }
    };
    expect(deriveRiskScore(data)).toBe(19); // round(18.75)
  });

  it('blocks high cancel-rate customers', () => {
    const data = {
      status: true,
      data: { Summaries: {}, totalSummary: { total: 10, success: 1, cancel: 9, successRate: 10, cancelRate: 90 } }
    };
    expect(deriveRiskScore(data)).toBe(90);
    expect(decideFraudRisk(deriveRiskScore(data))).toBe('blocked');
  });

  it('maps Pathao rating risk_level to a score', () => {
    const data = {
      status: true,
      data: {
        Summaries: { Pathao: { data_type: 'rating', risk_level: 'high', customer_rating: 'risky_customer' } },
        totalSummary: { total: 0, success: 0, cancel: 0, successRate: 0, cancelRate: 0 }
      }
    };
    expect(deriveRiskScore(data)).toBe(85);
  });

  it('takes the most conservative (max) of delivery and rating signals', () => {
    const data = {
      status: true,
      data: {
        Summaries: { Pathao: { data_type: 'rating', risk_level: 'very_high' } },
        totalSummary: { total: 8, success: 7, cancel: 1, successRate: 87.5, cancelRate: 12.5 }
      }
    };
    expect(deriveRiskScore(data)).toBe(95); // very_high beats round(12.5)=13
  });

  it('returns null when there is no history and no usable rating (new customer)', () => {
    const data = {
      status: true,
      data: {
        Summaries: { Pathao: { data_type: 'rating', risk_level: 'unknown', customer_rating: 'new_customer' } },
        totalSummary: { total: 0, success: 0, cancel: 0, successRate: 0, cancelRate: 0 }
      }
    };
    expect(deriveRiskScore(data)).toBeNull(); // -> routes to review
  });
});

describe('checkFraudBD', () => {
  it('handles API timeout', async () => {
    global.fetch = vi.fn().mockImplementation(() => new Promise((_, reject) => {
      setTimeout(() => reject(new Error('timeout')), 100);
    }));
    const result = await checkFraudBD('01712345678', 'test-key', 10);
    expect(result.score).toBeNull();
  });

  it('handles API error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network error'));
    const result = await checkFraudBD('01712345678', 'test-key', 3000);
    expect(result.score).toBeNull();
  });

  it('derives score from a Check Courier Info response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        status: true,
        message: 'ok',
        data: { Summaries: {}, totalSummary: { total: 20, success: 15, cancel: 5, successRate: 75, cancelRate: 25 } }
      }),
    } as Response);
    const result = await checkFraudBD('01712345678', 'test-key', 3000);
    expect(result.score).toBe(25);
  });

  it('sends api_key header and phone_number body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ status: true, data: { Summaries: {}, totalSummary: { total: 0, cancelRate: 0 } } }),
    } as Response);
    global.fetch = fetchMock;
    await checkFraudBD('01712345678', 'secret-key', 3000);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/api/check-courier-info');
    expect((init as any).headers.api_key).toBe('secret-key');
    expect(JSON.parse((init as any).body).phone_number).toBe('01712345678');
  });
});
