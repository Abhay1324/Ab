// Wallet Types
export type TransactionType = 'credit' | 'debit';

export interface WalletBalance {
  available: number;
  pending: number;
  minimumThreshold: number;
}

export interface Transaction {
  id: string;
  walletId: string;
  type: TransactionType;
  amount: number;
  balanceAfter: number;
  reason: string;
  createdAt: Date;
  metadata?: Record<string, unknown>;
}

export interface TransactionFilters {
  type?: TransactionType;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}
