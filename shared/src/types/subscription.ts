// Subscription Types
export type DeliveryFrequency = 'daily' | 'alternate' | 'weekly';
export type SubscriptionStatus = 'active' | 'paused' | 'cancelled';

export interface SubscriptionProduct {
  productId: string;
  quantity: number;
}

export interface SubscriptionInput {
  products: SubscriptionProduct[];
  frequency: DeliveryFrequency;
  deliverySlotId: string;
  startDate: Date;
}

export interface PauseInput {
  startDate: Date;
  endDate: Date;
  reason?: string;
}

export interface Subscription {
  id: string;
  customerId: string;
  addressId: string;
  deliverySlotId: string;
  products: SubscriptionProduct[];
  frequency: DeliveryFrequency;
  status: SubscriptionStatus;
  startDate: Date;
  pauseStart?: Date;
  pauseEnd?: Date;
  createdAt: Date;
}
