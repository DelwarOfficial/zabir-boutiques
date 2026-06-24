export interface AuditEntry {
  id: string;
  actor_staff_id: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  metadata_json: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  previous_hash: string;
  chain_hash: string;
}

export interface AuditEntryWithActor extends AuditEntry {
  actor_name: string | null;
}

export interface AuditFilter {
  action?: string;
  actor_id?: string;
  entity_type?: string;
  entity_id?: string;
  date_from?: string;
  date_to?: string;
  page: number;
  limit: number;
}

export interface PaginatedResult<T> {
  entries: T[];
  total: number;
  page: number;
  totalPages: number;
}

export interface ActionTypeMeta {
  action: string;
  label: string;
  category: string;
}

export const ACTION_CATEGORIES: Record<string, string> = {
  'staff': 'Staff & Auth',
  'role': 'Roles & Permissions',
  'order': 'Orders',
  'orders': 'Orders',
  'coupon': 'Coupons',
  'payment': 'Payments',
  'fraud': 'Fraud',
  'inventory': 'Inventory',
  'product': 'Products',
  'media': 'Media',
  'totp': 'Security / 2FA',
  'system': 'System',
  'api_key': 'API Keys',
  'customer': 'Customers',
  'ai': 'AI',
};

export function categorizeAction(action: string): string {
  for (const [prefix, category] of Object.entries(ACTION_CATEGORIES)) {
    if (action.startsWith(prefix)) return category;
  }
  return 'Other';
}

export function actionLabel(action: string): string {
  const parts = action.split('.');
  const verb = parts.pop() || '';
  const labelMap: Record<string, string> = {
    'create': 'Created',
    'update': 'Updated',
    'delete': 'Deleted',
    'view': 'Viewed',
    'list': 'Listed',
    'revoke': 'Revoked',
    'confirm': 'Confirmed',
    'cancel': 'Cancelled',
    'ship': 'Shipped',
    'pack': 'Packed',
    'override': 'Overrode',
    'login': 'Login',
    'logout': 'Logout',
    'upload': 'Uploaded',
    'enable': 'Enabled',
    'disable': 'Disabled',
    'verify': 'Verified',
    'setup': 'Setup',
    'fail': 'Failed',
    'success': 'Success',
    'request': 'Requested',
    'reset': 'Reset',
    'generate': 'Generated',
    'activate': 'Activated',
    'refund': 'Refunded',
    'handoff': 'Handed Off',
    'check': 'Checked',
    'delete_data': 'Data Deleted',
    'upgrade': 'Upgraded',
    'enforce': 'Enforced',
  };
  return labelMap[verb] || verb.replace(/_/g, ' ');
}

export function formatEntityType(type: string): string {
  const map: Record<string, string> = {
    'staff_user': 'Staff User',
    'role': 'Role',
    'order': 'Order',
    'coupon': 'Coupon',
    'api_key': 'API Key',
    'media_object': 'Media',
    'staff_session': 'Session',
    'fraud_check': 'Fraud Check',
  };
  return map[type] || type.replace(/_/g, ' ');
}
