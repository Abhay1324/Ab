// Authentication Types
export interface OTPResponse {
  success: boolean;
  expiresIn: number;
  attemptsRemaining: number;
}

export interface AuthToken {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  user: UserProfile;
}

export interface UserProfile {
  id: string;
  phone: string;
  name: string;
  email?: string;
  role: 'customer' | 'delivery_boy' | 'admin';
}

// Address Types
export interface Address {
  id?: string;
  line1: string;
  line2?: string;
  landmark?: string;
  city: string;
  state: string;
  pincode: string;
  coordinates?: { lat: number; lng: number };
  isDefault?: boolean;
}

// Customer Types
export interface Customer {
  id: string;
  phone: string;
  name: string;
  email?: string;
  addresses: Address[];
  isActive: boolean;
  createdAt: Date;
}

export interface CustomerProfileInput {
  name: string;
  phone: string;
  address: Address;
  pincode: string;
}

// Re-export all types
export * from './subscription.js';
export * from './wallet.js';
export * from './delivery.js';
export * from './product.js';
export * from './admin.js';
