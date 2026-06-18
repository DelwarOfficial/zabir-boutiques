export interface IdempotencyDOContract {
  claim(input: { key: string }): Promise<unknown>;
  complete(input: { key: string; orderId: string; responseBody: string }): Promise<unknown>;
  fail(input: { key: string }): Promise<unknown>;
}
