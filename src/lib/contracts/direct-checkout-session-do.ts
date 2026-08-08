/**
 * Session binding is a secret cookie hash (binding_secret), never Origin
 * or User-Agent [Master Plan V8 §10.6, RT-005, S-02]. Origin is checked
 * separately by the route handler on state-changing POSTs only, never
 * passed into the DO. There is no User-Agent parameter — it is a false
 * control that 403s real customers on legitimate UA changes mid-session.
 */
export interface DirectCheckoutSessionDOContract {
  create(input: { product_id: string; variant_id: string; quantity: number; selected_options: Record<string, string>; source_page: string; binding_secret: string }): Promise<{ session_id: string; expires_at: string }>;
  get(input: { session_id: string; binding_secret: string }): Promise<unknown>;
  updateFormDraft(input: { session_id: string; form_draft: Record<string, string>; binding_secret: string }): Promise<unknown>;
  markConvertedAndDelete(input: { session_id: string; order_id: string; binding_secret: string }): Promise<{ deleted: true } | { error: string }>;
}
