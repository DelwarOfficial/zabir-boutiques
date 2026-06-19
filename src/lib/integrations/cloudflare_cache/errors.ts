export class CloudflareCacheError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'CloudflareCacheError';
  }
}
