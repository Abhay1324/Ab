import type { Customer } from './index.js';
import type { Subscription } from './subscription.js';

// Admin Types
export interface DashboardMetrics {
  activeSubscriptions: number;
  todayDeliveries: {
    total: number;
    completed: number;
    pending: number;
    failed: number;
  };
  revenue: {
    today: number;
    thisMonth: number;
    thisYear: number;
  };
  newCustomers: {
    today: number;
    thisMonth: number;
  };
}

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

export interface CustomerDetails extends Customer {
  subscriptions: Subscription[];
  walletBalance: number;
  totalOrders: number;
}

export interface DeliveryBoy {
  id: string;
  phone: string;
  name: string;
  areaId: string;
  isActive: boolean;
  createdAt: Date;
}

export interface DeliveryBoyInput {
  phone: string;
  name: string;
  areaId: string;
  password: string;
}

export interface Area {
  id: string;
  name: string;
  pincodes: string[];
}

export interface ReportFilters {
  dateRange?: DateRange;
  status?: string;
  areaId?: string;
}
