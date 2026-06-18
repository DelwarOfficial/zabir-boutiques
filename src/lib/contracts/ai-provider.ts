export interface AIProviderContract {
  generateProductDescription(input: unknown): Promise<unknown>;
  generateAltText(input: unknown): Promise<unknown>;
  embedText?(input: unknown): Promise<unknown>;
}
