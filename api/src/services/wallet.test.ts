/**
 * Property-Based Tests for Wallet Module
 * Feature: milk-subscription
 * 
 * Property 8: Wallet Balance Invariant
 * Property 9: Low Balance Notification Trigger
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';
import { prisma } from '../lib/prisma.js';
import {
  getWalletBalance,
  addMoney,
  deductAmount,
  getTransactions,
  setLowBalanceNotificationHandler,
} from './wallet.service.js';

// Test fixtures
let testCustomer: any;
let testCounter = 0;

async function setupTestFixtures() {
  testCounter++;
  const uniquePhone = `98765${String(testCounter).padStart(5, '0')}`;
  
  // Create test customer with unique phone
  testCustomer = await prisma.customer.create({
    data: {
      phone: uniquePhone,
      name: 'Test Customer',
    },
  });
}

async function cleanupTestData() {
  // Clean up in correct order (respecting foreign key constraints)
  await prisma.transaction.deleteMany({});
  await prisma.wallet.deleteMany({});
}

describe('Wallet Service', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });


  /**
   * Property 8: Wallet Balance Invariant
   * For any sequence of wallet operations (credits and debits), the final balance
   * should equal initial balance plus sum of credits minus sum of debits.
   * Validates: Requirements 3.1, 3.2
   */
  describe('Property 8: Wallet Balance Invariant', () => {
    // Arbitrary for positive amounts (reasonable range for wallet operations)
    const positiveAmountArb = fc.integer({ min: 1, max: 10000 });

    it('for any sequence of credits, final balance should equal sum of all credits', async () => {
      await setupTestFixtures();

      await fc.assert(
        fc.asyncProperty(
          fc.array(positiveAmountArb, { minLength: 1, maxLength: 10 }),
          async (creditAmounts) => {
            // Get initial balance (should be 0 for new wallet)
            const initialBalance = await getWalletBalance(testCustomer.id);
            expect(initialBalance.available).toBe(0);

            // Apply all credits
            for (const amount of creditAmounts) {
              await addMoney(testCustomer.id, amount, 'test');
            }

            // Verify final balance equals sum of credits
            const finalBalance = await getWalletBalance(testCustomer.id);
            const expectedBalance = creditAmounts.reduce((sum, amt) => sum + amt, 0);
            expect(finalBalance.available).toBe(expectedBalance);

            // Clean up for next iteration
            await cleanupTestData();
            await setupTestFixtures();

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }, 120000);

    it('for any credit followed by debit of same amount, balance should return to initial', async () => {
      await setupTestFixtures();

      await fc.assert(
        fc.asyncProperty(
          positiveAmountArb,
          async (amount) => {
            // Get initial balance
            const initialBalance = await getWalletBalance(testCustomer.id);

            // Credit the amount
            await addMoney(testCustomer.id, amount, 'test');

            // Verify balance increased
            const afterCredit = await getWalletBalance(testCustomer.id);
            expect(afterCredit.available).toBe(initialBalance.available + amount);

            // Debit the same amount
            await deductAmount(testCustomer.id, amount, 'test debit');

            // Verify balance returned to initial
            const afterDebit = await getWalletBalance(testCustomer.id);
            expect(afterDebit.available).toBe(initialBalance.available);

            // Clean up for next iteration
            await cleanupTestData();
            await setupTestFixtures();

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }, 120000);

    it('for any sequence of credits and debits, final balance should equal initial + credits - debits', async () => {
      await setupTestFixtures();

      // Arbitrary for operations: either credit or debit with amount
      const operationArb = fc.record({
        type: fc.constantFrom('credit', 'debit'),
        amount: positiveAmountArb,
      });

      await fc.assert(
        fc.asyncProperty(
          fc.array(operationArb, { minLength: 1, maxLength: 10 }),
          async (operations) => {
            // Start with enough balance to handle debits
            const initialCredit = operations
              .filter((op) => op.type === 'debit')
              .reduce((sum, op) => sum + op.amount, 0) + 1000;

            await addMoney(testCustomer.id, initialCredit, 'initial');

            let expectedBalance = initialCredit;

            // Apply operations
            for (const op of operations) {
              if (op.type === 'credit') {
                await addMoney(testCustomer.id, op.amount, 'test credit');
                expectedBalance += op.amount;
              } else {
                // Only debit if we have sufficient balance
                if (expectedBalance >= op.amount) {
                  await deductAmount(testCustomer.id, op.amount, 'test debit');
                  expectedBalance -= op.amount;
                }
              }
            }

            // Verify final balance
            const finalBalance = await getWalletBalance(testCustomer.id);
            expect(finalBalance.available).toBe(expectedBalance);

            // Clean up for next iteration
            await cleanupTestData();
            await setupTestFixtures();

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }, 120000);

    it('transaction history should reflect all operations with correct balanceAfter', async () => {
      await setupTestFixtures();

      await fc.assert(
        fc.asyncProperty(
          fc.array(positiveAmountArb, { minLength: 2, maxLength: 5 }),
          async (amounts) => {
            // Apply credits
            for (const amount of amounts) {
              await addMoney(testCustomer.id, amount, 'test');
            }

            // Get transactions
            const transactions = await getTransactions(testCustomer.id);

            // Verify transaction count
            expect(transactions.length).toBe(amounts.length);

            // Verify each transaction's balanceAfter is cumulative
            let runningBalance = 0;
            // Transactions are ordered by createdAt desc, so reverse for chronological order
            const chronological = [...transactions].reverse();

            for (let i = 0; i < chronological.length; i++) {
              runningBalance += amounts[i]!;
              expect(chronological[i]!.balanceAfter).toBe(runningBalance);
            }

            // Clean up for next iteration
            await cleanupTestData();
            await setupTestFixtures();

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }, 120000);
  });


  /**
   * Property 9: Low Balance Notification Trigger
   * For any wallet where balance falls below minimum threshold after a transaction,
   * a low balance notification should be generated.
   * Validates: Requirements 3.3
   */
  describe('Property 9: Low Balance Notification Trigger', () => {
    const positiveAmountArb = fc.integer({ min: 1, max: 10000 });
    const DEFAULT_THRESHOLD = 100; // Wallet default threshold

    it('for any debit that causes balance to fall below threshold, notification should be triggered', async () => {
      await setupTestFixtures();

      await fc.assert(
        fc.asyncProperty(
          positiveAmountArb,
          async (initialAmount) => {
            // Track notification calls
            let notificationCalled = false;
            let notificationData: { customerId: string; balance: number; threshold: number } | null = null;

            setLowBalanceNotificationHandler(async (customerId, balance, thresh) => {
              notificationCalled = true;
              notificationData = { customerId, balance, threshold: thresh };
            });

            // Add initial amount (above default threshold)
            const totalInitial = initialAmount + DEFAULT_THRESHOLD + 100;
            await addMoney(testCustomer.id, totalInitial, 'initial');

            // Reset notification tracking
            notificationCalled = false;
            notificationData = null;

            // Debit amount that will bring balance below default threshold
            const debitAmount = initialAmount + 101; // This will leave balance below DEFAULT_THRESHOLD
            await deductAmount(testCustomer.id, debitAmount, 'test debit');

            // Verify notification was triggered
            expect(notificationCalled).toBe(true);
            expect(notificationData).not.toBeNull();
            expect(notificationData!.customerId).toBe(testCustomer.id);
            expect(notificationData!.balance).toBeLessThan(DEFAULT_THRESHOLD);

            // Clean up for next iteration
            await cleanupTestData();
            await setupTestFixtures();

            // Reset notification handler
            setLowBalanceNotificationHandler(async () => {});

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }, 120000);

    it('for any debit that keeps balance above threshold, notification should NOT be triggered', async () => {
      await setupTestFixtures();

      await fc.assert(
        fc.asyncProperty(
          positiveAmountArb,
          async (debitAmount) => {
            // Track notification calls
            let notificationCalled = false;

            setLowBalanceNotificationHandler(async () => {
              notificationCalled = true;
            });

            // Add enough to keep balance above default threshold after debit
            const initialAmount = debitAmount + DEFAULT_THRESHOLD + 100;
            await addMoney(testCustomer.id, initialAmount, 'initial');

            // Reset notification tracking
            notificationCalled = false;

            // Debit amount that will keep balance above threshold
            await deductAmount(testCustomer.id, debitAmount, 'test debit');

            // Verify notification was NOT triggered
            expect(notificationCalled).toBe(false);

            // Verify balance is still above threshold
            const balance = await getWalletBalance(testCustomer.id);
            expect(balance.available).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD);

            // Clean up for next iteration
            await cleanupTestData();
            await setupTestFixtures();

            // Reset notification handler
            setLowBalanceNotificationHandler(async () => {});

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }, 120000);

    it('notification should include correct balance and threshold values', async () => {
      await setupTestFixtures();

      await fc.assert(
        fc.asyncProperty(
          positiveAmountArb,
          async (amount) => {
            // Track notification data
            let capturedBalance = 0;
            let capturedThreshold = 0;

            setLowBalanceNotificationHandler(async (_customerId, balance, thresh) => {
              capturedBalance = balance;
              capturedThreshold = thresh;
            });

            // Add amount just above threshold
            const initialAmount = DEFAULT_THRESHOLD + amount;
            await addMoney(testCustomer.id, initialAmount, 'initial');

            // Debit to bring below threshold
            const debitAmount = amount + 1;
            await deductAmount(testCustomer.id, debitAmount, 'test debit');

            // Verify captured values match actual state
            const actualBalance = await getWalletBalance(testCustomer.id);
            expect(capturedBalance).toBe(actualBalance.available);
            expect(capturedThreshold).toBe(DEFAULT_THRESHOLD);

            // Clean up for next iteration
            await cleanupTestData();
            await setupTestFixtures();

            // Reset notification handler
            setLowBalanceNotificationHandler(async () => {});

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }, 120000);
  });
});
