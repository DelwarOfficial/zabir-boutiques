import { CourierError } from '../errors';

export class RedxError extends CourierError {
  constructor(message: string, code: string) {
    super(message, code, 'redx');
    this.name = 'RedxError';
  }
}