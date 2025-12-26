/**
 * Property-Based Tests for Delivery Module
 * Feature: milk-subscription
 *
 * Property 11: Route Optimization Validity
 * Property 12: Delivery Completion Integrity
 * Property 13: Failed Delivery Reason Required
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fc from 'fast-check';
import { prisma } from '../lib/prisma.js';
import {
  optimizeRoute,
  calculateTotalDistance,
  markDeliveryCompleted,
  markDeliveryFailed,
  validateDeliveryCompletion,
  validateFailedDeliveryReason,
  shouldDeliverOnDate,
} from './delivery.service.js';
import type { Delivery, DeliveryStatus, Address } from '@milk-subscription/shared';

// Arbitrary for coordinates (latitude/longitude)
const latitudeArb = fc.double({ min: 8.0, max: 37.0, noNaN: true });
const longitudeArb = fc.double({ min: 68.0, max: 97.0, noNaN: true });

// Arbitrary for address with coordinates
const addressWithCoordsArb = fc.record({
  line1: fc.string({ minLength: 1, maxLength: 50 }),
  city: fc.string({ minLength: 1, maxLength: 30 }),
  state: fc.string({ minLength: 1, maxLength: 30 }),
  pincode: fc.stringMatching(/^[1-9][0-9]{5}$/),
  coordinates: fc.record({
    lat: latitudeArb,
    lng: longitudeArb,
  }),
});

// Arbitrary for address without coordinates
const addressWithoutCoordsArb = fc.record({
  line1: fc.string({ minLength: 1, maxLength: 50 }),
  city: fc.string({ minLength: 1, maxLength: 30 }),
  state: fc.string({ minLength: 1, maxLength: 30 }),
  pincode: fc.stringMatching(/^[1-9][0-9]{5}$/),
});

// Helper to create a mock delivery object for testing
function createMockDelivery(
  id: string,
  address: Address,
  status: DeliveryStatus = 'pending'
): Delivery {
  return {
    id,
    subscriptionId: `sub-${id}`,
    customerId: `cust-${id}`,
    customerName: `Customer ${id}`,
    address,
    products: [{ productId: 'prod-1', productName: 'Milk', quantity: 1, unit: 'litre' }],
    status,
    scheduledSlot: { id: 'slot-1', startTime: '06:00', endTime: '08:00', label: 'Morning', isActive: true },
    deliveryDate: new Date(),
  };
}

// Test fixtures
let testCustomer: any;
let testAddress: any;
let testDeliverySlot: any;
let testProduct: any;
let testArea: any;
let testDeliveryBoy: any;
let testSubscription: any;

async function cleanupTestData() {
  await prisma.delivery.deleteMany({});
  await prisma.subscriptionProduct.deleteMany({});
  await prisma.subscription.deleteMany({});
  await prisma.address.deleteMany({});
  await prisma.deliveryBoy.deleteMany({});
  await prisma.area.deleteMany({});
  await prisma.customer.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.deliverySlot.deleteMany({});
}

async function setupTestFixtures() {
  await cleanupTestData();
  testArea = await prisma.area.create({ data: { name: 'Test Area', pincodes: '123456,123457' } });
  testDeliveryBoy = await prisma.deliveryBoy.create({
    data: { phone: '9876543211', name: 'Test Delivery Boy', password: '$2a$10$test', areaId: testArea.id, isActive: true },
  });
  testCustomer = await prisma.customer.create({ data: { phone: '9876543210', name: 'Test Customer' } });
  testAddress = await prisma.address.create({
    data: { customerId: testCustomer.id, line1: 'Test Address', city: 'Test City', state: 'Test State', pincode: '123456', latitude: 28.6139, longitude: 77.209, isDefault: true },
  });
  testDeliverySlot = await prisma.deliverySlot.create({ data: { startTime: '06:00', endTime: '08:00', label: 'Morning', isActive: true } });
  testProduct = await prisma.product.create({ data: { name: 'Full Cream Milk', description: 'Fresh milk', price: 60, unit: 'litre', isAvailable: true } });
  testSubscription = await prisma.subscription.create({
    data: {
      customerId: testCustomer.id, addressId: testAddress.id, deliverySlotId: testDeliverySlot.id,
      frequency: 'DAILY', status: 'ACTIVE', startDate: new Date(),
      products: { create: { productId: testProduct.id, quantity: 1, priceAtTime: testProduct.price } },
    },
  });
}

describe('Delivery Service', () => {
  beforeAll(async () => {
    await prisma.$connect();
    await setupTestFixtures();
  });

  afterAll(async () => {
    await cleanupTestData();
    await prisma.$disconnect();
  });

  describe('Property 11: Route Optimization Validity', () => {
    it('optimized route should not be significantly worse than original order', async () => {
      await fc.assert(
        fc.asyncProperty(fc.array(addressWithCoordsArb, { minLength: 2, maxLength: 10 }), async (addresses) => {
          const deliveries = addresses.map((addr, idx) => createMockDelivery(`del-${idx}`, addr as Address, 'pending'));
          const optimizedRoute = optimizeRoute(deliveries);
          const optimizedDistance = calculateTotalDistance(optimizedRoute);
          const originalDistance = calculateTotalDistance(deliveries);
          // Optimized route should not be more than 10% worse than original (allowing for heuristic imperfection)
          expect(optimizedDistance).toBeLessThanOrEqual(originalDistance * 1.1 + 1);
          return true;
        }),
        { numRuns: 50 }
      );
    }, 30000);

    it('single delivery optimized route returns same delivery', async () => {
      await fc.assert(
        fc.asyncProperty(addressWithCoordsArb, async (address) => {
          const delivery = createMockDelivery('del-1', address as Address, 'pending');
          const optimized = optimizeRoute([delivery]);
          expect(optimized.length).toBe(1);
          expect(optimized[0]!.id).toBe(delivery.id);
          return true;
        }),
        { numRuns: 50 }
      );
    }, 30000);

    it('optimized route contains all original deliveries', async () => {
      await fc.assert(
        fc.asyncProperty(fc.array(addressWithCoordsArb, { minLength: 1, maxLength: 10 }), async (addresses) => {
          const deliveries = addresses.map((addr, idx) => createMockDelivery(`del-${idx}`, addr as Address, 'pending'));
          const optimized = optimizeRoute(deliveries);
          expect(optimized.length).toBe(deliveries.length);
          const originalIds = new Set(deliveries.map((d) => d.id));
          const optimizedIds = new Set(optimized.map((d) => d.id));
          expect(optimizedIds).toEqual(originalIds);
          return true;
        }),
        { numRuns: 50 }
      );
    }, 30000);

    it('deliveries without coordinates placed at end', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(addressWithCoordsArb, { minLength: 1, maxLength: 5 }),
          fc.array(addressWithoutCoordsArb, { minLength: 1, maxLength: 3 }),
          async (withCoords, withoutCoords) => {
            const deliveriesWithCoords = withCoords.map((addr, idx) => createMockDelivery(`with-${idx}`, addr as Address, 'pending'));
            const deliveriesWithoutCoords = withoutCoords.map((addr, idx) => createMockDelivery(`without-${idx}`, addr as Address, 'pending'));
            const allDeliveries = [...deliveriesWithCoords, ...deliveriesWithoutCoords];
            const optimized = optimizeRoute(allDeliveries);
            const withoutCoordsIds = new Set(deliveriesWithoutCoords.map((d) => d.id));
            const lastN = optimized.slice(-withoutCoords.length);
            for (const delivery of lastN) {
              expect(withoutCoordsIds.has(delivery.id)).toBe(true);
            }
            return true;
          }
        ),
        { numRuns: 50 }
      );
    }, 30000);
  });

  describe('Property 12: Delivery Completion Integrity', () => {
    it('completed delivery has status delivered and proof present', async () => {
      await fc.assert(
        fc.asyncProperty(fc.constantFrom('photo', 'signature'), fc.webUrl(), async (proofType, proofUrl) => {
          const delivery = await prisma.delivery.create({
            data: { subscriptionId: testSubscription.id, deliveryBoyId: testDeliveryBoy.id, deliveryDate: new Date(), status: 'PENDING' },
          });
          const completed = await markDeliveryCompleted(delivery.id, testDeliveryBoy.id, { type: proofType as 'photo' | 'signature', url: proofUrl, capturedAt: new Date() });
          const validation = validateDeliveryCompletion(completed);
          expect(validation.hasStatus).toBe(true);
          expect(validation.hasProof).toBe(true);
          expect(validation.isValid).toBe(true);
          expect(completed.status).toBe('delivered');
          expect(completed.proof!.url).toBe(proofUrl);
          await prisma.delivery.delete({ where: { id: delivery.id } });
          return true;
        }),
        { numRuns: 10 }
      );
    }, 30000);

    it('delivery without proof completion fails', async () => {
      const delivery = await prisma.delivery.create({
        data: { subscriptionId: testSubscription.id, deliveryBoyId: testDeliveryBoy.id, deliveryDate: new Date(), status: 'PENDING' },
      });
      await expect(markDeliveryCompleted(delivery.id, testDeliveryBoy.id, { type: 'photo', url: '', capturedAt: new Date() })).rejects.toThrow('Please capture delivery proof');
      await prisma.delivery.delete({ where: { id: delivery.id } });
    });

    it('validateDeliveryCompletion returns false for incomplete deliveries', () => {
      const incompleteDelivery: Delivery = {
        id: 'test-1', subscriptionId: 'sub-1', customerId: 'cust-1', customerName: 'Test',
        address: { line1: 'Test', city: 'Test', state: 'Test', pincode: '123456' },
        products: [], status: 'delivered',
        scheduledSlot: { id: 's1', startTime: '06:00', endTime: '08:00', label: 'Morning', isActive: true },
        deliveryDate: new Date(),
      };
      const validation = validateDeliveryCompletion(incompleteDelivery);
      expect(validation.hasProof).toBe(false);
      expect(validation.isValid).toBe(false);
    });
  });

  describe('Property 13: Failed Delivery Reason Required', () => {
    it('failed delivery has failure reason present', async () => {
      const failureReasons = ['CUSTOMER_UNAVAILABLE', 'WRONG_ADDRESS', 'CUSTOMER_REFUSED', 'ACCESS_DENIED', 'WEATHER_CONDITIONS', 'VEHICLE_BREAKDOWN', 'OTHER'];
      await fc.assert(
        fc.asyncProperty(fc.constantFrom(...failureReasons), fc.option(fc.string({ minLength: 1, maxLength: 100 }), { nil: undefined }), async (reasonCode, notes) => {
          const delivery = await prisma.delivery.create({
            data: { subscriptionId: testSubscription.id, deliveryBoyId: testDeliveryBoy.id, deliveryDate: new Date(), status: 'PENDING' },
          });
          const failed = await markDeliveryFailed(delivery.id, testDeliveryBoy.id, { code: reasonCode, description: '', notes });
          const isValid = validateFailedDeliveryReason(failed);
          expect(isValid).toBe(true);
          expect(failed.status).toBe('failed');
          expect(failed.failureReason!.code).toBe(reasonCode);
          await prisma.delivery.delete({ where: { id: delivery.id } });
          return true;
        }),
        { numRuns: 10 }
      );
    }, 30000);

    it('delivery without reason marking as failed fails', async () => {
      const delivery = await prisma.delivery.create({
        data: { subscriptionId: testSubscription.id, deliveryBoyId: testDeliveryBoy.id, deliveryDate: new Date(), status: 'PENDING' },
      });
      await expect(markDeliveryFailed(delivery.id, testDeliveryBoy.id, { code: '', description: '' })).rejects.toThrow('Please select failure reason');
      await prisma.delivery.delete({ where: { id: delivery.id } });
    });

    it('validateFailedDeliveryReason returns false for failed deliveries without reason', () => {
      const failedWithoutReason: Delivery = {
        id: 'test-1', subscriptionId: 'sub-1', customerId: 'cust-1', customerName: 'Test',
        address: { line1: 'Test', city: 'Test', state: 'Test', pincode: '123456' },
        products: [], status: 'failed',
        scheduledSlot: { id: 's1', startTime: '06:00', endTime: '08:00', label: 'Morning', isActive: true },
        deliveryDate: new Date(),
      };
      expect(validateFailedDeliveryReason(failedWithoutReason)).toBe(false);
    });

    it('validateFailedDeliveryReason returns true for non-failed deliveries', () => {
      const pendingDelivery: Delivery = {
        id: 'test-1', subscriptionId: 'sub-1', customerId: 'cust-1', customerName: 'Test',
        address: { line1: 'Test', city: 'Test', state: 'Test', pincode: '123456' },
        products: [], status: 'pending',
        scheduledSlot: { id: 's1', startTime: '06:00', endTime: '08:00', label: 'Morning', isActive: true },
        deliveryDate: new Date(),
      };
      expect(validateFailedDeliveryReason(pendingDelivery)).toBe(true);
    });
  });

  describe('Delivery Service - Unit Tests', () => {
    it('shouldDeliverOnDate returns correct values for daily frequency', () => {
      const startDate = new Date('2024-01-01');
      expect(shouldDeliverOnDate(startDate, new Date('2024-01-01'), 'DAILY')).toBe(true);
      expect(shouldDeliverOnDate(startDate, new Date('2024-01-02'), 'DAILY')).toBe(true);
      expect(shouldDeliverOnDate(startDate, new Date('2024-01-10'), 'DAILY')).toBe(true);
    });

    it('shouldDeliverOnDate returns correct values for alternate frequency', () => {
      const startDate = new Date('2024-01-01');
      expect(shouldDeliverOnDate(startDate, new Date('2024-01-01'), 'ALTERNATE')).toBe(true);
      expect(shouldDeliverOnDate(startDate, new Date('2024-01-02'), 'ALTERNATE')).toBe(false);
      expect(shouldDeliverOnDate(startDate, new Date('2024-01-03'), 'ALTERNATE')).toBe(true);
      expect(shouldDeliverOnDate(startDate, new Date('2024-01-04'), 'ALTERNATE')).toBe(false);
    });

    it('shouldDeliverOnDate returns correct values for weekly frequency', () => {
      const startDate = new Date('2024-01-01');
      expect(shouldDeliverOnDate(startDate, new Date('2024-01-01'), 'WEEKLY')).toBe(true);
      expect(shouldDeliverOnDate(startDate, new Date('2024-01-02'), 'WEEKLY')).toBe(false);
      expect(shouldDeliverOnDate(startDate, new Date('2024-01-08'), 'WEEKLY')).toBe(true);
      expect(shouldDeliverOnDate(startDate, new Date('2024-01-15'), 'WEEKLY')).toBe(true);
    });

    it('shouldDeliverOnDate returns false for dates before start date', () => {
      const startDate = new Date('2024-01-10');
      expect(shouldDeliverOnDate(startDate, new Date('2024-01-01'), 'DAILY')).toBe(false);
      expect(shouldDeliverOnDate(startDate, new Date('2024-01-09'), 'DAILY')).toBe(false);
    });

    it('calculateTotalDistance returns 0 for empty or single delivery', () => {
      expect(calculateTotalDistance([])).toBe(0);
      const singleDelivery = createMockDelivery('1', { line1: 'Test', city: 'Test', state: 'Test', pincode: '123456', coordinates: { lat: 28.6139, lng: 77.209 } });
      expect(calculateTotalDistance([singleDelivery])).toBe(0);
    });
  });
});
