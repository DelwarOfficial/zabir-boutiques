// Label types
export type CourierProvider = 'pathao' | 'steadfast' | 'redx';

export interface LabelData {
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  paymentMethod: string;
  totalPaisa: number;
  advancePaisa: number;
  balancePaisa: number;
  paymentStatus: string;
  storeName: string;
  storeAddress: string;
  storePhone: string;
}

export interface LabelResult {
  html: string;
  filename: string;
}

// API client types
export interface CourierEnv {
  DB: D1Database;
  PROVIDER_HEALTH_DO: DurableObjectNamespace;
  PATHAO_CLIENT_ID: string;
  PATHAO_CLIENT_SECRET: string;
  PATHAO_BASE_URL?: string;
  STEADFAST_API_KEY: string;
  STEADFAST_SECRET: string;
  STEADFAST_BASE_URL?: string;
  REDX_API_TOKEN: string;
  REDX_BASE_URL?: string;
}

export interface CreateShipmentInput {
  orderId: string;
  recipientName: string;
  recipientPhone: string;
  recipientAddress: string;
  recipientCity: string;
  recipientZone: string;
  codAmountPaisa: number;
  weight: number;
  itemCount: number;
  specialNote?: string;
}

export interface CreateShipmentResult {
  ok: boolean;
  trackingNumber?: string;
  rawResponse: string;
  errorCode?: string;
}

export interface TrackingResult {
  ok: boolean;
  status: string;
  events: { timestamp: string; location: string; description: string }[];
  rawResponse: string;
  errorCode?: string;
}

export interface CancelShipmentResult {
  ok: boolean;
  rawResponse: string;
  errorCode?: string;
}

export interface CourierProviderInterface {
  createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult>;
  trackShipment(trackingNumber: string): Promise<TrackingResult>;
  cancelShipment(trackingNumber: string): Promise<CancelShipmentResult>;
}
