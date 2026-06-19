import { CourierError } from '../errors';

export class PathaoError extends CourierError {
  constructor(message: string, code: string) {
    super(message, code, 'pathao');
    this.name = 'PathaoError';
  }
}