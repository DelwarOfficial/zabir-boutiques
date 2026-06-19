export class CourierError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly provider: string,
  ) {
    super(message);
    this.name = 'CourierError';
  }
}
