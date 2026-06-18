export interface CartDOContract {
  addItem(input: unknown): Promise<unknown>;
  removeItem(input: unknown): Promise<unknown>;
  changeQuantity(input: unknown): Promise<unknown>;
  clearCart(input: unknown): Promise<unknown>;
  getCart(input: unknown): Promise<unknown>;
  alarm(): Promise<void>;
}
