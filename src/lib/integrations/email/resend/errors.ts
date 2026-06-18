export class ResendEmailError extends Error {
  constructor(message: string, readonly code = 'RESEND_ERROR') {
    super(message);
  }
}
