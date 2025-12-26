import type { Address } from './index.js';

// Delivery Types
export type DeliveryStatus = 'pending' | 'in_progress' | 'delivered' | 'failed';

export interface DeliverySlot {
  id: string;
  startTime: string;
  endTime: string;
  label: string;
  isActive: boolean;
}

export interface DeliveryProduct {
  productId: string;
  productName: string;
  quantity: number;
  unit: string;
}

export interface DeliveryProof {
  type: 'photo' | 'signature';
  url: string;
  capturedAt: Date;
}

export interface FailureReason {
  code: string;
  description: string;
  notes?: string;
}

export interface Delivery {
  id: string;
  subscriptionId: string;
  customerId: string;
  customerName: string;
  deliveryBoyId?: string;
  address: Address;
  products: DeliveryProduct[];
  status: DeliveryStatus;
  scheduledSlot: DeliverySlot;
  deliveryDate: Date;
  completedAt?: Date;
  proof?: DeliveryProof;
  failureReason?: FailureReason;
}

export interface DeliveryRoute {
  deliveries: Delivery[];
  totalDistance: number;
  estimatedTime: number;
}

export interface DeliveryFilters {
  status?: DeliveryStatus;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}
