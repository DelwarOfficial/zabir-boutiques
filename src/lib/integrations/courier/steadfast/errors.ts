import { CourierError } from '../errors';

export class SteadfastError extends CourierError {
  constructor(message: string, code: string) {
    super(message, code, 'steadfast');
    this.name = 'SteadfastError';
  }
}