export class DeepSeekError extends Error {
  constructor(message: string, readonly code = 'DEEPSEEK_ERROR') {
    super(message);
  }
}
