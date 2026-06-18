export interface DirectCheckoutSessionDOContract {
  create(input: { product_id: string; variant_id: string; quantity: number; selected_options: Record<string, string>; source_page: string; origin: string; user_agent: string }): Promise<{ session_id: string; expires_at: string }>;
  get(input: { session_id: string; origin: string; user_agent: string }): Promise<unknown>;
  updateFormDraft(input: { session_id: string; form_draft: Record<string, string>; origin: string; user_agent: string }): Promise<unknown>;
  markConvertedAndDelete(input: { session_id: string; order_id: string; origin: string; user_agent: string }): Promise<{ deleted: true } | { error: string }>;
}
