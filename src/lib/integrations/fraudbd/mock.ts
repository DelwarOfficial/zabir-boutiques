import type { FraudBDResult } from './types';

export class MockFraudBDClient {
  async checkCourierInfo(): Promise<FraudBDResult> {
    return { data: { status: true, data: { totalSummary: { total: 1, cancelRate: 10 } } }, rawResponse: '{}', circuitOpen: false };
  }
}
