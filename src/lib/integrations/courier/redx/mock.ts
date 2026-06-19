import type { CourierProviderInterface, CreateShipmentInput, CreateShipmentResult, TrackingResult, CancelShipmentResult } from '../types';

export class MockRedxClient implements CourierProviderInterface {
  async createShipment(input: CreateShipmentInput): Promise<CreateShipmentResult> {
    return { ok: true, trackingNumber: `REDX-${input.orderId}`, rawResponse: '{}' };
  }
  async trackShipment(trackingNumber: string): Promise<TrackingResult> {
    return { ok: true, status: 'in_transit', events: [], rawResponse: '{}' };
  }
  async cancelShipment(_trackingNumber: string): Promise<CancelShipmentResult> {
    return { ok: true, rawResponse: '{}' };
  }
}
