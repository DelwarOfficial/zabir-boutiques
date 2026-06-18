export class FraudBDError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'FraudBDError';
  }
}
