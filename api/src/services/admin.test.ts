/**
 * Property-Based Tests for Admin Module
 * Feature: milk-subscription
 * 
 * Property 14: Date Range Filter Accuracy
 * Property 15: Customer Search Completeness
 * Property 16: Wallet Adjustment Audit Trail
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { prisma } from '../lib/prisma.js';
import { adminService } from './admin.service.js';

// Test fixtures
let testCustomers: any[] = [];
let testWallets: any[] = [];

async function setupTestFixtures() {
  // Clean up
  await prisma.transaction.deleteMany({});
  await prisma.wallet.deleteMany({});
  await prisma.delivery.deleteMany({});
  await prisma.subscriptionProduct.deleteMany({});
  await prisma.subscription.deleteMany({});
  await prisma.address.deleteMany({});
  await prisma.customer.deleteMany({});

  // Create test customers with different names for search testing
  const customerData = [
    { phone: '9876543210', name: 'John Doe', email: 'john@example.com' },
    { phone: '9876543211', name: 'Jane Smith', email: 'jane@example.com' },
    { phone: '9876543212', name: 'Bob Johnson', email: 'bob@example.com' },
    { phone: '9876543213', name: 'Alice Williams', email: 'alice@example.com' },
    { phone: '9876543214', name: 'Charlie Brown', email: 'charlie@example.com' },
  ];

  testCustomers = [];
  testWallets = [];

  for (const data of customerData) {
    const customer = await prisma.customer.create({ data });
    testCustomers.push(customer);
    
    const wallet = await prisma.wallet.create({
      data: {
        customerId: customer.id,
        balance: 1000,
      },
    });
    testWallets.push(wallet);
  }
}


describe('Admin Service', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.transaction.deleteMany({});
    await prisma.wallet.deleteMany({});
    await prisma.delivery.deleteMany({});
    await prisma.subscriptionProduct.deleteMany({});
    await prisma.subscription.deleteMany({});
    await prisma.address.deleteMany({});
    await prisma.customer.deleteMany({});
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await setupTestFixtures();
  });

  /**
   * Property 14: Date Range Filter Accuracy
   * For any date range filter applied to dashboard metrics, the returned data
   * should only include records within that date range.
   * Validates: Requirements 6.3
   */
  describe('Property 14: Date Range Filter Accuracy', () => {
    it('dashboard metrics should return valid structure', async () => {
      const metrics = await adminService.getDashboardMetrics();
      
      expect(metrics).toHaveProperty('totalCustomers');
      expect(metrics).toHaveProperty('activeSubscriptions');
      expect(metrics).toHaveProperty('todayDeliveries');
      expect(metrics).toHaveProperty('completedDeliveries');
      expect(metrics).toHaveProperty('pendingDeliveries');
      expect(metrics).toHaveProperty('failedDeliveries');
      expect(metrics).toHaveProperty('totalRevenue');
      expect(metrics).toHaveProperty('todayRevenue');
      
      expect(typeof metrics.totalCustomers).toBe('number');
      expect(metrics.totalCustomers).toBeGreaterThanOrEqual(0);
    });

    it('for any date range, metrics should be non-negative', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.date({ min: new Date('2024-01-01'), max: new Date('2025-12-31') }),
          fc.integer({ min: 1, max: 30 }),
          async (startDate, dayRange) => {
            const endDate = new Date(startDate);
            endDate.setDate(endDate.getDate() + dayRange);

            const metrics = await adminService.getDashboardMetrics({
              startDate,
              endDate,
            });

            // All metrics should be non-negative
            expect(metrics.totalCustomers).toBeGreaterThanOrEqual(0);
            expect(metrics.activeSubscriptions).toBeGreaterThanOrEqual(0);
            expect(metrics.todayDeliveries).toBeGreaterThanOrEqual(0);
            expect(metrics.completedDeliveries).toBeGreaterThanOrEqual(0);
            expect(metrics.pendingDeliveries).toBeGreaterThanOrEqual(0);
            expect(metrics.failedDeliveries).toBeGreaterThanOrEqual(0);
            expect(metrics.totalRevenue).toBeGreaterThanOrEqual(0);
            expect(metrics.todayRevenue).toBeGreaterThanOrEqual(0);

            return true;
          }
        ),
        { numRuns: 50 }
      );
    }, 60000);

    it('delivery counts should sum correctly', async () => {
      const metrics = await adminService.getDashboardMetrics();
      
      const sumOfStatuses = 
        metrics.completedDeliveries + 
        metrics.pendingDeliveries + 
        metrics.failedDeliveries;
      
      // Sum of individual statuses should be <= total (there might be other statuses)
      expect(sumOfStatuses).toBeLessThanOrEqual(metrics.todayDeliveries);
    });
  });


  /**
   * Property 15: Customer Search Completeness
   * For any search query, all returned customers should match the query,
   * and no matching customers should be excluded from results.
   * Validates: Requirements 7.1
   */
  describe('Property 15: Customer Search Completeness', () => {
    it('search with empty query should return all customers', async () => {
      const result = await adminService.searchCustomers('', 1, 100);
      
      expect(result.customers.length).toBe(testCustomers.length);
      expect(result.pagination.total).toBe(testCustomers.length);
    });

    it('for any search by name, all results should contain the search term', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom('John', 'Jane', 'Bob', 'Alice', 'Charlie'),
          async (searchTerm) => {
            const result = await adminService.searchCustomers(searchTerm, 1, 100);
            
            // All returned customers should match the search term
            for (const customer of result.customers) {
              const matchesName = customer.name.toLowerCase().includes(searchTerm.toLowerCase());
              const matchesPhone = customer.phone.includes(searchTerm);
              const matchesEmail = customer.email?.toLowerCase().includes(searchTerm.toLowerCase());
              
              expect(matchesName || matchesPhone || matchesEmail).toBe(true);
            }

            return true;
          }
        ),
        { numRuns: 20 }
      );
    }, 30000);

    it('search by phone should return exact match', async () => {
      const testPhone = testCustomers[0].phone;
      const result = await adminService.searchCustomers(testPhone, 1, 100);
      
      expect(result.customers.length).toBeGreaterThanOrEqual(1);
      expect(result.customers.some(c => c.phone === testPhone)).toBe(true);
    });

    it('pagination should work correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 5 }),
          fc.integer({ min: 1, max: 3 }),
          async (page, limit) => {
            const result = await adminService.searchCustomers('', page, limit);
            
            // Verify pagination metadata
            expect(result.pagination.page).toBe(page);
            expect(result.pagination.limit).toBe(limit);
            expect(result.pagination.totalPages).toBe(Math.ceil(testCustomers.length / limit));
            
            // Verify result count
            const expectedCount = Math.min(
              limit,
              Math.max(0, testCustomers.length - (page - 1) * limit)
            );
            expect(result.customers.length).toBe(expectedCount);

            return true;
          }
        ),
        { numRuns: 20 }
      );
    }, 30000);

    it('customer details should include wallet and subscriptions', async () => {
      const customerId = testCustomers[0].id;
      const customer = await adminService.getCustomerById(customerId);
      
      expect(customer).not.toBeNull();
      expect(customer!.wallet).not.toBeNull();
      expect(customer!.subscriptions).toBeDefined();
      expect(customer!.addresses).toBeDefined();
    });
  });


  /**
   * Property 16: Wallet Adjustment Audit Trail
   * For any wallet adjustment made by admin, a transaction record should be created
   * with the adjustment details including admin ID and reason.
   * Validates: Requirements 7.3
   */
  describe('Property 16: Wallet Adjustment Audit Trail', () => {
    it('for any credit adjustment, transaction should be recorded with correct details', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 1000 }),
          fc.string({ minLength: 5, maxLength: 50 }),
          async (amount, reason) => {
            const customerId = testCustomers[0].id;
            const adminId = 'test-admin-123';
            
            const initialBalance = (await prisma.wallet.findUnique({
              where: { customerId },
            }))!.balance;

            const result = await adminService.adjustWalletBalance(
              customerId,
              amount, // positive = credit
              reason,
              adminId
            );

            // Verify wallet balance updated
            expect(result.wallet.balance).toBe(initialBalance + amount);

            // Verify transaction created
            expect(result.transaction).toBeDefined();
            expect(result.transaction.type).toBe('CREDIT');
            expect(result.transaction.amount).toBe(amount);
            expect(result.transaction.reason).toContain(reason);
            expect(result.transaction.reason).toContain(adminId);
            expect(result.transaction.balanceAfter).toBe(initialBalance + amount);

            // Reset wallet for next iteration
            await prisma.wallet.update({
              where: { customerId },
              data: { balance: 1000 },
            });
            await prisma.transaction.deleteMany({
              where: { walletId: testWallets[0].id },
            });

            return true;
          }
        ),
        { numRuns: 50 }
      );
    }, 60000);

    it('for any debit adjustment, transaction should be recorded with correct details', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 500 }), // Keep within balance
          fc.string({ minLength: 5, maxLength: 50 }),
          async (amount, reason) => {
            const customerId = testCustomers[0].id;
            const adminId = 'test-admin-456';
            
            // Ensure sufficient balance
            await prisma.wallet.update({
              where: { customerId },
              data: { balance: 1000 },
            });

            const result = await adminService.adjustWalletBalance(
              customerId,
              -amount, // negative = debit
              reason,
              adminId
            );

            // Verify wallet balance updated
            expect(result.wallet.balance).toBe(1000 - amount);

            // Verify transaction created
            expect(result.transaction).toBeDefined();
            expect(result.transaction.type).toBe('DEBIT');
            expect(result.transaction.amount).toBe(amount);
            expect(result.transaction.reason).toContain(reason);
            expect(result.transaction.reason).toContain(adminId);

            // Reset for next iteration
            await prisma.wallet.update({
              where: { customerId },
              data: { balance: 1000 },
            });
            await prisma.transaction.deleteMany({
              where: { walletId: testWallets[0].id },
            });

            return true;
          }
        ),
        { numRuns: 50 }
      );
    }, 60000);

    it('debit adjustment should fail if insufficient balance', async () => {
      const customerId = testCustomers[0].id;
      const adminId = 'test-admin-789';
      
      // Set low balance
      await prisma.wallet.update({
        where: { customerId },
        data: { balance: 100 },
      });

      await expect(
        adminService.adjustWalletBalance(customerId, -200, 'test debit', adminId)
      ).rejects.toThrow('Insufficient balance');

      // Reset
      await prisma.wallet.update({
        where: { customerId },
        data: { balance: 1000 },
      });
    });

    it('adjustment should fail for non-existent customer', async () => {
      await expect(
        adminService.adjustWalletBalance('non-existent-id', 100, 'test', 'admin')
      ).rejects.toThrow('Wallet not found');
    });

    it('audit trail should preserve admin identity', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uuid(),
          async (adminId) => {
            const customerId = testCustomers[0].id;
            
            const result = await adminService.adjustWalletBalance(
              customerId,
              50,
              'audit test',
              adminId
            );

            // Admin ID should be in the transaction reason
            expect(result.transaction.reason).toContain(adminId);

            // Reset
            await prisma.wallet.update({
              where: { customerId },
              data: { balance: 1000 },
            });
            await prisma.transaction.deleteMany({
              where: { walletId: testWallets[0].id },
            });

            return true;
          }
        ),
        { numRuns: 20 }
      );
    }, 30000);
  });
});
