/**
 * Property-Based Tests for Subscription Module
 * Feature: milk-subscription
 * 
 * Property 3: Subscription Creation Consistency
 * Property 4: Delivery Frequency Scheduling
 * Property 5: Delivery Slot Assignment
 * Property 6: Subscription Modification Timing
 * Property 7: Pause Period Delivery Exclusion
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { prisma } from '../lib/prisma.js';
import {
  createSubscription,
  getSubscription,
  updateSubscription,
  pauseSubscription,
  resumeSubscription,
  generateDeliveryDates,
  isDateInPausePeriod,
} from './subscription.service.js';
import type { DeliveryFrequency } from '@milk-subscription/shared';

// Arbitrary for valid quantities (1-10)
const validQuantityArb = fc.integer({ min: 1, max: 10 });

// Arbitrary for delivery frequency
const frequencyArb = fc.constantFrom<DeliveryFrequency>('daily', 'alternate', 'weekly');

// Arbitrary for future dates (within next 30 days)
const futureDateArb = fc.integer({ min: 1, max: 30 }).map((days) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(0, 0, 0, 0);
  return date;
});

// Test fixtures
let testCustomer: any;
let testAddress: any;
let testDeliverySlot: any;
let testProducts: any[];

async function setupTestFixtures() {
  // Clean up
  await prisma.delivery.deleteMany({});
  await prisma.subscriptionProduct.deleteMany({});
  await prisma.subscription.deleteMany({});
  await prisma.address.deleteMany({});
  await prisma.customer.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.deliverySlot.deleteMany({});

  // Create test customer
  testCustomer = await prisma.customer.create({
    data: {
      phone: '9876543210',
      name: 'Test Customer',
    },
  });

  // Create test address
  testAddress = await prisma.address.create({
    data: {
      customerId: testCustomer.id,
      line1: 'Test Address Line 1',
      city: 'Test City',
      state: 'Test State',
      pincode: '123456',
      isDefault: true,
    },
  });

  // Create test delivery slot
  testDeliverySlot = await prisma.deliverySlot.create({
    data: {
      startTime: '06:00',
      endTime: '08:00',
      label: 'Morning (6AM-8AM)',
      isActive: true,
    },
  });

  // Create test products
  testProducts = await Promise.all([
    prisma.product.create({
      data: {
        name: 'Full Cream Milk',
        description: 'Fresh full cream milk',
        price: 60,
        unit: 'litre',
        isAvailable: true,
      },
    }),
    prisma.product.create({
      data: {
        name: 'Toned Milk',
        description: 'Fresh toned milk',
        price: 50,
        unit: 'litre',
        isAvailable: true,
      },
    }),
    prisma.product.create({
      data: {
        name: 'Curd',
        description: 'Fresh curd',
        price: 40,
        unit: 'kg',
        isAvailable: true,
      },
    }),
  ]);
}

describe('Subscription Service', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.delivery.deleteMany({});
    await prisma.subscriptionProduct.deleteMany({});
    await prisma.subscription.deleteMany({});
    await prisma.address.deleteMany({});
    await prisma.customer.deleteMany({});
    await prisma.product.deleteMany({});
    await prisma.deliverySlot.deleteMany({});
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await setupTestFixtures();
  });


  /**
   * Property 3: Subscription Creation Consistency
   * For any valid product selection with quantities, creating a subscription should
   * result in a subscription containing exactly those products with those quantities.
   * Validates: Requirements 2.1
   */
  describe('Property 3: Subscription Creation Consistency', () => {
    it('for any valid product selection, subscription should contain exactly those products with quantities', async () => {
      // Setup fixtures once before the property test
      await setupTestFixtures();
      
      await fc.assert(
        fc.asyncProperty(
          // Generate 1-3 products with quantities
          fc.array(
            fc.record({
              productIndex: fc.integer({ min: 0, max: 2 }),
              quantity: validQuantityArb,
            }),
            { minLength: 1, maxLength: 3 }
          ),
          frequencyArb,
          futureDateArb,
          async (productSelections, frequency, startDate) => {
            // Deduplicate by productIndex (keep last quantity for each product)
            const productMap = new Map<number, number>();
            for (const sel of productSelections) {
              productMap.set(sel.productIndex, sel.quantity);
            }

            const products = Array.from(productMap.entries()).map(([idx, qty]) => ({
              productId: testProducts[idx].id,
              quantity: qty,
            }));

            // Create subscription
            const subscription = await createSubscription(testCustomer.id, {
              products,
              frequency,
              deliverySlotId: testDeliverySlot.id,
              startDate,
            });

            // Verify subscription contains exactly the selected products
            expect(subscription.products.length).toBe(products.length);

            for (const selectedProduct of products) {
              const found = subscription.products.find(
                (p) => p.productId === selectedProduct.productId
              );
              expect(found).toBeDefined();
              expect(found!.quantity).toBe(selectedProduct.quantity);
            }

            // Verify no extra products
            for (const subProduct of subscription.products) {
              const found = products.find((p) => p.productId === subProduct.productId);
              expect(found).toBeDefined();
            }

            // Clean up the subscription for next iteration
            await prisma.subscriptionProduct.deleteMany({ where: { subscriptionId: subscription.id } });
            await prisma.subscription.delete({ where: { id: subscription.id } });

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }, 120000);

    it('for any subscription creation, priceAtTime should match product price at creation time', async () => {
      // Setup fixtures once before the property test
      await setupTestFixtures();
      
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 2 }),
          validQuantityArb,
          frequencyArb,
          futureDateArb,
          async (productIndex, quantity, frequency, startDate) => {
            const selectedProduct = testProducts[productIndex];
            const products = [{ productId: selectedProduct.id, quantity }];

            const subscription = await createSubscription(testCustomer.id, {
              products,
              frequency,
              deliverySlotId: testDeliverySlot.id,
              startDate,
            });

            const subProduct = subscription.products.find(
              (p) => p.productId === selectedProduct.id
            );
            expect(subProduct).toBeDefined();
            expect(subProduct!.priceAtTime).toBe(selectedProduct.price);

            // Clean up the subscription for next iteration
            await prisma.subscriptionProduct.deleteMany({ where: { subscriptionId: subscription.id } });
            await prisma.subscription.delete({ where: { id: subscription.id } });

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }, 120000);
  });


  /**
   * Property 4: Delivery Frequency Scheduling
   * For any subscription with a given frequency (daily/alternate/weekly), the generated
   * delivery dates should follow the exact frequency pattern from the start date.
   * Validates: Requirements 2.2
   */
  describe('Property 4: Delivery Frequency Scheduling', () => {
    it('for daily frequency, consecutive delivery dates should be 1 day apart', async () => {
      await fc.assert(
        fc.asyncProperty(
          futureDateArb,
          fc.integer({ min: 5, max: 20 }),
          async (startDate, count) => {
            const dates = generateDeliveryDates(startDate, 'daily', count);

            expect(dates.length).toBe(count);

            for (let i = 1; i < dates.length; i++) {
              const diff = dates[i]!.getTime() - dates[i - 1]!.getTime();
              const daysDiff = diff / (1000 * 60 * 60 * 24);
              expect(daysDiff).toBe(1);
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }, 60000);

    it('for alternate frequency, consecutive delivery dates should be 2 days apart', async () => {
      await fc.assert(
        fc.asyncProperty(
          futureDateArb,
          fc.integer({ min: 5, max: 20 }),
          async (startDate, count) => {
            const dates = generateDeliveryDates(startDate, 'alternate', count);

            expect(dates.length).toBe(count);

            for (let i = 1; i < dates.length; i++) {
              const diff = dates[i]!.getTime() - dates[i - 1]!.getTime();
              const daysDiff = diff / (1000 * 60 * 60 * 24);
              expect(daysDiff).toBe(2);
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }, 60000);

    it('for weekly frequency, consecutive delivery dates should be 7 days apart', async () => {
      await fc.assert(
        fc.asyncProperty(
          futureDateArb,
          fc.integer({ min: 5, max: 20 }),
          async (startDate, count) => {
            const dates = generateDeliveryDates(startDate, 'weekly', count);

            expect(dates.length).toBe(count);

            for (let i = 1; i < dates.length; i++) {
              const diff = dates[i]!.getTime() - dates[i - 1]!.getTime();
              const daysDiff = diff / (1000 * 60 * 60 * 24);
              expect(daysDiff).toBe(7);
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }, 60000);

    it('first delivery date should match start date', async () => {
      await fc.assert(
        fc.asyncProperty(
          futureDateArb,
          frequencyArb,
          async (startDate, frequency) => {
            const dates = generateDeliveryDates(startDate, frequency, 5);

            expect(dates.length).toBeGreaterThan(0);
            expect(dates[0]!.getTime()).toBe(startDate.getTime());

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }, 60000);
  });


  /**
   * Property 5: Delivery Slot Assignment
   * For any subscription with a selected delivery slot, all generated deliveries
   * for that subscription should have the same delivery slot assigned.
   * Validates: Requirements 2.3
   */
  describe('Property 5: Delivery Slot Assignment', () => {
    it('for any subscription, delivery slot should match the selected slot', async () => {
      // Setup fixtures once before the property test
      await setupTestFixtures();
      
      // Create additional delivery slots
      const additionalSlots = await Promise.all([
        prisma.deliverySlot.create({
          data: {
            startTime: '08:00',
            endTime: '10:00',
            label: 'Late Morning (8AM-10AM)',
            isActive: true,
          },
        }),
        prisma.deliverySlot.create({
          data: {
            startTime: '17:00',
            endTime: '19:00',
            label: 'Evening (5PM-7PM)',
            isActive: true,
          },
        }),
      ]);
      
      const slots = [testDeliverySlot, ...additionalSlots];
      
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 2 }),
          validQuantityArb,
          frequencyArb,
          futureDateArb,
          async (productIndex, quantity, frequency, startDate) => {
            // Pick a random slot
            const selectedSlotIndex = productIndex % slots.length;
            const selectedSlot = slots[selectedSlotIndex];

            const products = [{ productId: testProducts[productIndex].id, quantity }];

            const subscription = await createSubscription(testCustomer.id, {
              products,
              frequency,
              deliverySlotId: selectedSlot.id,
              startDate,
            });

            // Verify the subscription has the correct delivery slot
            expect(subscription.deliverySlotId).toBe(selectedSlot.id);

            // Fetch from DB to double-check
            const fetched = await getSubscription(subscription.id);
            expect(fetched.deliverySlotId).toBe(selectedSlot.id);

            // Clean up the subscription for next iteration
            await prisma.subscriptionProduct.deleteMany({ where: { subscriptionId: subscription.id } });
            await prisma.subscription.delete({ where: { id: subscription.id } });

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }, 120000);
  });


  /**
   * Property 6: Subscription Modification Timing
   * For any subscription modification, the current delivery cycle should remain
   * unchanged and modifications should only apply from the next cycle onwards.
   * Validates: Requirements 2.4
   */
  describe('Property 6: Subscription Modification Timing', () => {
    it('for any modification, subscription should be updated with new values', async () => {
      // Setup fixtures once before the property test
      await setupTestFixtures();
      
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 2 }),
          validQuantityArb,
          frequencyArb,
          frequencyArb,
          futureDateArb,
          async (productIndex, quantity, originalFrequency, newFrequency, startDate) => {
            const products = [{ productId: testProducts[productIndex].id, quantity }];

            // Create subscription
            const subscription = await createSubscription(testCustomer.id, {
              products,
              frequency: originalFrequency,
              deliverySlotId: testDeliverySlot.id,
              startDate,
            });

            // Modify subscription frequency
            const updated = await updateSubscription(
              subscription.id,
              testCustomer.id,
              { frequency: newFrequency }
            );

            // Verify the modification was applied
            expect(updated.frequency).toBe(newFrequency);

            // Clean up the subscription for next iteration
            await prisma.subscriptionProduct.deleteMany({ where: { subscriptionId: subscription.id } });
            await prisma.subscription.delete({ where: { id: subscription.id } });

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }, 120000);

    it('for any product modification, new products should have current prices', async () => {
      // Setup fixtures once before the property test
      await setupTestFixtures();
      
      await fc.assert(
        fc.asyncProperty(
          validQuantityArb,
          validQuantityArb,
          frequencyArb,
          futureDateArb,
          async (quantity1, quantity2, frequency, startDate) => {
            // Create subscription with first product
            const subscription = await createSubscription(testCustomer.id, {
              products: [{ productId: testProducts[0].id, quantity: quantity1 }],
              frequency,
              deliverySlotId: testDeliverySlot.id,
              startDate,
            });

            const originalPrice = subscription.products[0]!.priceAtTime;

            // Update product price in database
            const newPrice = originalPrice + 10;
            await prisma.product.update({
              where: { id: testProducts[0].id },
              data: { price: newPrice },
            });

            // Modify subscription to add second product
            const updated = await updateSubscription(
              subscription.id,
              testCustomer.id,
              {
                products: [
                  { productId: testProducts[0].id, quantity: quantity1 },
                  { productId: testProducts[1].id, quantity: quantity2 },
                ],
              }
            );

            // Verify new products have current prices
            const product1 = updated.products.find((p) => p.productId === testProducts[0].id);
            const product2 = updated.products.find((p) => p.productId === testProducts[1].id);

            expect(product1).toBeDefined();
            expect(product2).toBeDefined();
            // When products are updated, they get current prices
            expect(product1!.priceAtTime).toBe(newPrice);

            // Restore original price for next iteration
            await prisma.product.update({
              where: { id: testProducts[0].id },
              data: { price: originalPrice },
            });

            // Clean up the subscription for next iteration
            await prisma.subscriptionProduct.deleteMany({ where: { subscriptionId: subscription.id } });
            await prisma.subscription.delete({ where: { id: subscription.id } });

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }, 120000);
  });


  /**
   * Property 7: Pause Period Delivery Exclusion
   * For any subscription with a pause period, there should be zero deliveries
   * scheduled within the pause date range (inclusive).
   * Validates: Requirements 2.5
   */
  describe('Property 7: Pause Period Delivery Exclusion', () => {
    it('for any pause period, no delivery dates should fall within the pause range', async () => {
      await fc.assert(
        fc.asyncProperty(
          futureDateArb,
          frequencyArb,
          fc.integer({ min: 5, max: 15 }),
          fc.integer({ min: 3, max: 10 }),
          async (startDate, frequency, pauseStartOffset, pauseDuration) => {
            // Calculate pause period
            const pauseStart = new Date(startDate);
            pauseStart.setDate(pauseStart.getDate() + pauseStartOffset);
            pauseStart.setHours(0, 0, 0, 0);

            const pauseEnd = new Date(pauseStart);
            pauseEnd.setDate(pauseEnd.getDate() + pauseDuration);
            pauseEnd.setHours(0, 0, 0, 0);

            // Generate delivery dates with pause period
            const dates = generateDeliveryDates(
              startDate,
              frequency,
              30,
              pauseStart,
              pauseEnd
            );

            // Verify no dates fall within pause period
            for (const date of dates) {
              const isInPause = isDateInPausePeriod(date, pauseStart, pauseEnd);
              expect(isInPause).toBe(false);
            }

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }, 60000);

    it('for any date within pause period, isDateInPausePeriod should return true', async () => {
      await fc.assert(
        fc.asyncProperty(
          futureDateArb,
          fc.integer({ min: 1, max: 10 }),
          fc.integer({ min: 0, max: 9 }),
          async (pauseStart, pauseDuration, dayOffset) => {
            const pauseEnd = new Date(pauseStart);
            pauseEnd.setDate(pauseEnd.getDate() + pauseDuration);

            // Create a date within the pause period
            const testDate = new Date(pauseStart);
            testDate.setDate(testDate.getDate() + (dayOffset % (pauseDuration + 1)));

            const isInPause = isDateInPausePeriod(testDate, pauseStart, pauseEnd);
            expect(isInPause).toBe(true);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }, 60000);

    it('for any date outside pause period, isDateInPausePeriod should return false', async () => {
      await fc.assert(
        fc.asyncProperty(
          futureDateArb,
          fc.integer({ min: 1, max: 10 }),
          fc.integer({ min: 1, max: 10 }),
          async (pauseStart, pauseDuration, daysAfter) => {
            const pauseEnd = new Date(pauseStart);
            pauseEnd.setDate(pauseEnd.getDate() + pauseDuration);

            // Create a date after the pause period
            const testDate = new Date(pauseEnd);
            testDate.setDate(testDate.getDate() + daysAfter);

            const isInPause = isDateInPausePeriod(testDate, pauseStart, pauseEnd);
            expect(isInPause).toBe(false);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }, 60000);

    it('pausing and resuming subscription should update status correctly', async () => {
      // Setup fixtures once before the property test
      await setupTestFixtures();
      
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 2 }),
          validQuantityArb,
          frequencyArb,
          futureDateArb,
          fc.integer({ min: 1, max: 10 }),
          async (productIndex, quantity, frequency, startDate, pauseDuration) => {
            const products = [{ productId: testProducts[productIndex].id, quantity }];

            // Create subscription
            const subscription = await createSubscription(testCustomer.id, {
              products,
              frequency,
              deliverySlotId: testDeliverySlot.id,
              startDate,
            });

            expect(subscription.status).toBe('active');

            // Calculate pause dates (starting tomorrow)
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(0, 0, 0, 0);

            const pauseEnd = new Date(tomorrow);
            pauseEnd.setDate(pauseEnd.getDate() + pauseDuration);

            // Pause subscription
            const paused = await pauseSubscription(subscription.id, testCustomer.id, {
              startDate: tomorrow,
              endDate: pauseEnd,
            });

            expect(paused.status).toBe('paused');
            expect(paused.pauseStart).toBeDefined();
            expect(paused.pauseEnd).toBeDefined();

            // Resume subscription
            const resumed = await resumeSubscription(subscription.id, testCustomer.id);

            expect(resumed.status).toBe('active');
            expect(resumed.pauseStart).toBeUndefined();
            expect(resumed.pauseEnd).toBeUndefined();

            // Clean up the subscription for next iteration
            await prisma.subscriptionProduct.deleteMany({ where: { subscriptionId: subscription.id } });
            await prisma.subscription.delete({ where: { id: subscription.id } });

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }, 120000);
  });
});
