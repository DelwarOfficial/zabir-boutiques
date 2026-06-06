import { describe, it, expect, vi } from 'vitest';
import { decideFraudRisk, checkFraudBD } from '../src/lib/fraud';

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

describe('checkFraudBD', () => {
  it('handles API timeout', async () => {
    global.fetch = vi.fn().mockImplementation(() => new Promise((_, reject) => {
      setTimeout(() => reject(new Error('timeout')), 100);
    }));

    const result = await checkFraudBD('+8801712345678', 'test-key', 10);
    expect(result.score).toBeNull();
  });

  it('handles API error', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network error'));
    const result = await checkFraudBD('+8801712345678', 'test-key', 3000);
    expect(result.score).toBeNull();
  });

  it('parses risk score from response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ risk_score: 25 }),
    } as Response);
    const result = await checkFraudBD('+8801712345678', 'test-key', 3000);
    expect(result.score).toBe(25);
  });
});
