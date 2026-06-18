export class TinifyError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'TinifyError';
  }
}
