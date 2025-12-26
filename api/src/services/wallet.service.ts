import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errorHandler.js';
import type { WalletBalance, Transaction, TransactionFilters, TransactionType } from '@milk-subscription/shared';
import { sendLowBalanceNotification } from './notification.service.js';

/**
 * Wallet Service
 * Handles wallet operations: balance check, add money, deduct amount, threshold notifications
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */

// Notification callback type for low balance alerts
export type LowBalanceNotificationCallback = (customerId: string, balance: number, threshold: number) => void | Promise<void>;

// Default notification handler - now wired to notification service
let lowBalanceNotificationHandler: LowBalanceNotificationCallback = sendLowBalanceNotification;

/**
 * Sets the low balance notification handler
 */
export function setLowBalanceNotificationHandler(handler: LowBalanceNotificationCallback): void {
  lowBalanceNotificationHandler = handler;
}

/**
 * Transforms a Prisma transaction to the shared Transaction type
 */
function transformTransaction(transaction: any): Transaction {
  return {
    id: transaction.id,
    walletId: transaction.walletId,
    type: transaction.type.toLowerCase() as TransactionType,
    amount: transaction.amount,
    balanceAfter: transaction.balanceAfter,
    reason: transaction.reason,
    createdAt: transaction.createdAt,
    metadata: transaction.metadata ? JSON.parse(transaction.metadata) : undefined,
  };
}

/**
 * Gets or creates a wallet for a customer
 */
export async function getOrCreateWallet(customerId: string): Promise<{ id: string; balance: number; minimumThreshold: number }> {
  // Check if customer exists
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
  });

  if (!customer) {
    throw ApiError.notFound('WAL_004', 'Wallet not found for customer');
  }

  // Get or create wallet
  let wallet = await prisma.wallet.findUnique({
    where: { customerId },
  });

  if (!wallet) {
    wallet = await prisma.wallet.create({
      data: {
        customerId,
        balance: 0,
        minimumThreshold: 100,
      },
    });
  }

  return {
    id: wallet.id,
    balance: wallet.balance,
    minimumThreshold: wallet.minimumThreshold,
  };
}


/**
 * Gets wallet balance for a customer
 * Requirements: 3.1
 */
export async function getWalletBalance(customerId: string): Promise<WalletBalance> {
  const wallet = await getOrCreateWallet(customerId);

  return {
    available: wallet.balance,
    pending: 0, // Reserved for future use (e.g., pending refunds)
    minimumThreshold: wallet.minimumThreshold,
  };
}

/**
 * Adds money to wallet (credit)
 * Requirements: 3.1
 */
export async function addMoney(
  customerId: string,
  amount: number,
  paymentMethod: string,
  paymentReference?: string
): Promise<Transaction> {
  if (amount <= 0) {
    throw ApiError.badRequest('WAL_002', 'Amount must be greater than 0');
  }

  const wallet = await getOrCreateWallet(customerId);

  // Create transaction and update balance atomically
  const transaction = await prisma.$transaction(async (tx) => {
    const newBalance = wallet.balance + amount;

    // Update wallet balance
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: newBalance },
    });

    // Create transaction record
    const txn = await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: 'CREDIT',
        amount,
        balanceAfter: newBalance,
        reason: `Added money via ${paymentMethod}`,
        metadata: JSON.stringify({
          paymentMethod,
          paymentReference,
        }),
      },
    });

    return txn;
  });

  return transformTransaction(transaction);
}

/**
 * Deducts amount from wallet (debit)
 * Requirements: 3.2, 3.3, 3.4
 */
export async function deductAmount(
  customerId: string,
  amount: number,
  reason: string,
  metadata?: Record<string, unknown>
): Promise<Transaction> {
  if (amount <= 0) {
    throw ApiError.badRequest('WAL_002', 'Amount must be greater than 0');
  }

  const wallet = await getOrCreateWallet(customerId);

  if (wallet.balance < amount) {
    throw ApiError.badRequest('WAL_001', 'Insufficient wallet balance. Please recharge');
  }

  // Create transaction and update balance atomically
  const result = await prisma.$transaction(async (tx) => {
    const newBalance = wallet.balance - amount;

    // Update wallet balance
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: newBalance },
    });

    // Create transaction record
    const txn = await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: 'DEBIT',
        amount,
        balanceAfter: newBalance,
        reason,
        metadata: metadata ? JSON.stringify(metadata) : null,
      },
    });

    return { transaction: txn, newBalance, threshold: wallet.minimumThreshold };
  });

  // Check if balance fell below threshold and trigger notification
  // Requirements: 3.3
  if (result.newBalance < result.threshold) {
    await triggerLowBalanceNotification(customerId, result.newBalance, result.threshold);
  }

  return transformTransaction(result.transaction);
}


/**
 * Triggers low balance notification
 * Requirements: 3.3
 */
async function triggerLowBalanceNotification(
  customerId: string,
  balance: number,
  threshold: number
): Promise<void> {
  try {
    await lowBalanceNotificationHandler(customerId, balance, threshold);
  } catch (error) {
    // Log error but don't fail the transaction
    console.error('Failed to send low balance notification:', error);
  }
}

/**
 * Checks if wallet has sufficient balance for next delivery
 * Requirements: 3.4
 */
export async function checkSufficientBalance(
  customerId: string,
  requiredAmount: number
): Promise<{ sufficient: boolean; balance: number; shortfall: number }> {
  const wallet = await getOrCreateWallet(customerId);

  const sufficient = wallet.balance >= requiredAmount;
  const shortfall = sufficient ? 0 : requiredAmount - wallet.balance;

  return {
    sufficient,
    balance: wallet.balance,
    shortfall,
  };
}

/**
 * Gets wallet transactions with optional filters
 */
export async function getTransactions(
  customerId: string,
  filters?: TransactionFilters
): Promise<Transaction[]> {
  const wallet = await getOrCreateWallet(customerId);

  const where: any = { walletId: wallet.id };

  if (filters?.type) {
    where.type = filters.type.toUpperCase();
  }

  if (filters?.startDate || filters?.endDate) {
    where.createdAt = {};
    if (filters.startDate) {
      where.createdAt.gte = filters.startDate;
    }
    if (filters.endDate) {
      where.createdAt.lte = filters.endDate;
    }
  }

  const transactions = await prisma.transaction.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: filters?.limit ?? 50,
    skip: filters?.offset ?? 0,
  });

  return transactions.map(transformTransaction);
}

/**
 * Adjusts wallet balance (admin operation)
 * Requirements: 7.3 (Admin wallet adjustment with audit)
 */
export async function adjustBalance(
  customerId: string,
  amount: number,
  reason: string,
  adminId: string
): Promise<Transaction> {
  if (amount === 0) {
    throw ApiError.badRequest('WAL_002', 'Amount must be greater than 0');
  }

  const wallet = await getOrCreateWallet(customerId);

  const newBalance = wallet.balance + amount;

  if (newBalance < 0) {
    throw ApiError.badRequest('WAL_001', 'Adjustment would result in negative balance');
  }

  // Create transaction and update balance atomically
  const result = await prisma.$transaction(async (tx) => {
    // Update wallet balance
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: newBalance },
    });

    // Create transaction record
    const txn = await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: amount > 0 ? 'CREDIT' : 'DEBIT',
        amount: Math.abs(amount),
        balanceAfter: newBalance,
        reason: `Admin adjustment: ${reason}`,
        metadata: JSON.stringify({
          adminId,
          adjustmentReason: reason,
        }),
      },
    });

    // Create audit log
    await tx.auditLog.create({
      data: {
        adminId,
        action: 'WALLET_ADJUSTMENT',
        entityType: 'WALLET',
        entityId: wallet.id,
        details: JSON.stringify({
          customerId,
          amount,
          reason,
          previousBalance: wallet.balance,
          newBalance,
        }),
      },
    });

    return { transaction: txn, newBalance, threshold: wallet.minimumThreshold };
  });

  // Check if balance fell below threshold after adjustment
  if (amount < 0 && result.newBalance < result.threshold) {
    await triggerLowBalanceNotification(customerId, result.newBalance, result.threshold);
  }

  return transformTransaction(result.transaction);
}

/**
 * Updates minimum threshold for a wallet
 */
export async function updateMinimumThreshold(
  customerId: string,
  threshold: number
): Promise<WalletBalance> {
  if (threshold < 0) {
    throw ApiError.badRequest('WAL_005', 'Threshold must be non-negative');
  }

  const wallet = await getOrCreateWallet(customerId);

  await prisma.wallet.update({
    where: { id: wallet.id },
    data: { minimumThreshold: threshold },
  });

  return {
    available: wallet.balance,
    pending: 0,
    minimumThreshold: threshold,
  };
}
