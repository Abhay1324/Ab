/**
 * Property-Based Tests for Delivery Boy Module
 * Feature: milk-subscription
 * 
 * Property 17: Delivery Boy Area Assignment
 * Property 18: Area Reassignment Cascade
 * Property 10: Delivery Boy Authentication
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { prisma } from '../lib/prisma.js';
import {
  createDeliveryBoy,
  getDeliveryBoyById,
  createArea,
  getAreaById,
  validateDeliveryBoyAreaAssignment,
  reassignDeliveryBoyArea,
  authenticateDeliveryBoy,
  getTodayDeliveries,
  verifyDeliveryBoyCredentials,
} from './deliveryBoy.service.js';

// Arbitrary for valid phone numbers (10 digits)
const validPhoneArb = fc
  .stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), { minLength: 10, maxLength: 10 })
  .filter((s) => s[0] !== '0'); // Phone shouldn't start with 0

// Arbitrary for valid names
const validNameArb = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => s.trim().length > 0);

// Arbitrary for valid passwords
const validPasswordArb = fc
  .string({ minLength: 6, maxLength: 50 })
  .filter((s) => s.trim().length >= 6);

// Arbitrary for valid area names
const validAreaNameArb = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => s.trim().length > 0);

// Arbitrary for valid pincodes (6 digits)
const validPincodeArb = fc
  .stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9'), { minLength: 6, maxLength: 6 });

// Arbitrary for array of pincodes
const validPincodesArb = fc
  .array(validPincodeArb, { minLength: 1, maxLength: 5 })
  .map((arr) => [...new Set(arr)]); // Ensure unique pincodes

describe('Delivery Boy Service', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    // Final cleanup - respect foreign key constraints
    await prisma.delivery.deleteMany({});
    await prisma.subscriptionProduct.deleteMany({});
    await prisma.subscription.deleteMany({});
    await prisma.deliveryBoy.deleteMany({});
    await prisma.area.deleteMany({});
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean up before each test - respect foreign key constraints
    await prisma.delivery.deleteMany({});
    await prisma.subscriptionProduct.deleteMany({});
    await prisma.subscription.deleteMany({});
    await prisma.deliveryBoy.deleteMany({});
    await prisma.area.deleteMany({});
  });


  /**
   * Property 17: Delivery Boy Area Assignment
   * For any newly created delivery boy, they must have exactly one area assigned
   * and that area must be valid.
   * Validates: Requirements 8.1
   */
  describe('Property 17: Delivery Boy Area Assignment', () => {
    it('for any newly created delivery boy, they must have exactly one valid area assigned', async () => {
      let phoneCounter = 1000000000;
      
      await fc.assert(
        fc.asyncProperty(
          validNameArb,
          validPasswordArb,
          validAreaNameArb,
          validPincodesArb,
          async (name, password, areaName, pincodes) => {
            // Create an area first
            const area = await createArea({
              name: areaName,
              pincodes: pincodes,
            });

            // Generate unique phone for this test run
            const phone = String(phoneCounter++);

            // Create delivery boy with the area
            const deliveryBoy = await createDeliveryBoy({
              phone,
              name,
              password,
              areaId: area.id,
            });

            // Verify delivery boy has exactly one area assigned
            expect(deliveryBoy.areaId).toBeDefined();
            expect(deliveryBoy.areaId).toBe(area.id);

            // Verify the area is valid (exists and can be retrieved)
            const assignedArea = await getAreaById(deliveryBoy.areaId);
            expect(assignedArea).toBeDefined();
            expect(assignedArea.id).toBe(area.id);

            // Verify using the validation function
            const isValid = await validateDeliveryBoyAreaAssignment(deliveryBoy.id);
            expect(isValid).toBe(true);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }, 120000);

    it('creating delivery boy with invalid area should fail', async () => {
      await fc.assert(
        fc.asyncProperty(
          validPhoneArb,
          validNameArb,
          validPasswordArb,
          async (phone, name, password) => {
            // Try to create delivery boy with non-existent area
            const invalidAreaId = 'non-existent-area-id';

            await expect(
              createDeliveryBoy({
                phone,
                name,
                password,
                areaId: invalidAreaId,
              })
            ).rejects.toThrow();

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }, 120000);
  });

  /**
   * Property 18: Area Reassignment Cascade
   * For any delivery boy area reassignment, all their pending deliveries should be
   * reassigned to delivery boys covering the affected addresses.
   * Validates: Requirements 8.3
   */
  describe('Property 18: Area Reassignment Cascade', () => {
    it('for any area reassignment, pending deliveries should be reassigned to appropriate delivery boys', async () => {
      let phoneCounter = 2000000000;
      
      await fc.assert(
        fc.asyncProperty(
          validNameArb,
          validPasswordArb,
          async (name, password) => {
            // Clean up before test
            await prisma.delivery.deleteMany({});
            await prisma.subscriptionProduct.deleteMany({});
            await prisma.subscription.deleteMany({});
            await prisma.address.deleteMany({});
            await prisma.wallet.deleteMany({});
            await prisma.customer.deleteMany({});
            await prisma.deliverySlot.deleteMany({});
            await prisma.deliveryBoy.deleteMany({});
            await prisma.area.deleteMany({});

            // Create two areas with different pincodes
            const area1 = await createArea({
              name: 'Area 1',
              pincodes: ['110001', '110002'],
            });

            const area2 = await createArea({
              name: 'Area 2',
              pincodes: ['110003', '110004'],
            });

            // Create delivery boy 1 in area 1
            const phone1 = String(phoneCounter++);
            const deliveryBoy1 = await createDeliveryBoy({
              phone: phone1,
              name: name + '1',
              password,
              areaId: area1.id,
            });

            // Create delivery boy 2 in area 2
            const phone2 = String(phoneCounter++);
            const deliveryBoy2 = await createDeliveryBoy({
              phone: phone2,
              name: name + '2',
              password,
              areaId: area2.id,
            });

            // Create a customer with address in area 2's pincode
            const customer = await prisma.customer.create({
              data: {
                phone: '9876543210',
                name: 'Test Customer',
              },
            });

            const address = await prisma.address.create({
              data: {
                customerId: customer.id,
                line1: 'Test Address',
                city: 'Test City',
                state: 'Test State',
                pincode: '110003', // In area 2
                isDefault: true,
              },
            });

            // Create a delivery slot
            const deliverySlot = await prisma.deliverySlot.create({
              data: {
                startTime: '06:00',
                endTime: '08:00',
                label: 'Morning',
                isActive: true,
              },
            });

            // Create a subscription
            const subscription = await prisma.subscription.create({
              data: {
                customerId: customer.id,
                addressId: address.id,
                deliverySlotId: deliverySlot.id,
                frequency: 'DAILY',
                status: 'ACTIVE',
                startDate: new Date(),
              },
            });

            // Create a pending delivery assigned to delivery boy 1
            const delivery = await prisma.delivery.create({
              data: {
                subscriptionId: subscription.id,
                deliveryBoyId: deliveryBoy1.id,
                deliveryDate: new Date(),
                status: 'PENDING',
              },
            });

            // Reassign delivery boy 1 to area 2 (which doesn't cover the delivery address)
            // Actually, let's reassign to a new area that doesn't cover 110003
            const area3 = await createArea({
              name: 'Area 3',
              pincodes: ['110005', '110006'],
            });

            const result = await reassignDeliveryBoyArea(deliveryBoy1.id, area3.id);

            // Verify the delivery boy's area was updated
            expect(result.deliveryBoy.areaId).toBe(area3.id);

            // Verify the delivery was reassigned
            const updatedDelivery = await prisma.delivery.findUnique({
              where: { id: delivery.id },
            });

            // The delivery should be reassigned to delivery boy 2 (who covers 110003)
            // or unassigned if no one covers it
            expect(updatedDelivery).toBeDefined();
            expect(updatedDelivery!.deliveryBoyId).not.toBe(deliveryBoy1.id);
            
            // Since delivery boy 2 covers 110003, it should be assigned to them
            expect(updatedDelivery!.deliveryBoyId).toBe(deliveryBoy2.id);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }, 120000);

    it('for any area reassignment with no covering delivery boy, deliveries should be unassigned', async () => {
      let phoneCounter = 3000000000;
      
      await fc.assert(
        fc.asyncProperty(
          validNameArb,
          validPasswordArb,
          async (name, password) => {
            // Clean up before test
            await prisma.delivery.deleteMany({});
            await prisma.subscriptionProduct.deleteMany({});
            await prisma.subscription.deleteMany({});
            await prisma.address.deleteMany({});
            await prisma.wallet.deleteMany({});
            await prisma.customer.deleteMany({});
            await prisma.deliverySlot.deleteMany({});
            await prisma.deliveryBoy.deleteMany({});
            await prisma.area.deleteMany({});

            // Create one area
            const area1 = await createArea({
              name: 'Area 1',
              pincodes: ['220001', '220002'],
            });

            // Create delivery boy in area 1
            const phone1 = String(phoneCounter++);
            const deliveryBoy1 = await createDeliveryBoy({
              phone: phone1,
              name,
              password,
              areaId: area1.id,
            });

            // Create a customer with address in area 1's pincode
            const customer = await prisma.customer.create({
              data: {
                phone: '9876543211',
                name: 'Test Customer 2',
              },
            });

            const address = await prisma.address.create({
              data: {
                customerId: customer.id,
                line1: 'Test Address 2',
                city: 'Test City',
                state: 'Test State',
                pincode: '220001', // In area 1
                isDefault: true,
              },
            });

            // Create a delivery slot
            const deliverySlot = await prisma.deliverySlot.create({
              data: {
                startTime: '06:00',
                endTime: '08:00',
                label: 'Morning',
                isActive: true,
              },
            });

            // Create a subscription
            const subscription = await prisma.subscription.create({
              data: {
                customerId: customer.id,
                addressId: address.id,
                deliverySlotId: deliverySlot.id,
                frequency: 'DAILY',
                status: 'ACTIVE',
                startDate: new Date(),
              },
            });

            // Create a pending delivery assigned to delivery boy 1
            const delivery = await prisma.delivery.create({
              data: {
                subscriptionId: subscription.id,
                deliveryBoyId: deliveryBoy1.id,
                deliveryDate: new Date(),
                status: 'PENDING',
              },
            });

            // Create a new area that doesn't cover 220001
            const area2 = await createArea({
              name: 'Area 2',
              pincodes: ['330001', '330002'],
            });

            // Reassign delivery boy 1 to area 2
            const result = await reassignDeliveryBoyArea(deliveryBoy1.id, area2.id);

            // Verify the delivery boy's area was updated
            expect(result.deliveryBoy.areaId).toBe(area2.id);

            // Verify the delivery was unassigned (no other delivery boy covers 220001)
            const updatedDelivery = await prisma.delivery.findUnique({
              where: { id: delivery.id },
            });

            expect(updatedDelivery).toBeDefined();
            expect(updatedDelivery!.deliveryBoyId).toBeNull();

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }, 120000);
  });

  /**
   * Property 10: Delivery Boy Authentication
   * For any valid delivery boy credentials, authentication should succeed and
   * return today's assigned deliveries.
   * Validates: Requirements 4.1, 4.2
   */
  describe('Property 10: Delivery Boy Authentication', () => {
    it('for any valid credentials, authentication should succeed', async () => {
      let phoneCounter = 4000000000;
      
      await fc.assert(
        fc.asyncProperty(
          validNameArb,
          validPasswordArb,
          validAreaNameArb,
          validPincodesArb,
          async (name, password, areaName, pincodes) => {
            // Create an area
            const area = await createArea({
              name: areaName,
              pincodes: pincodes,
            });

            // Generate unique phone for this test run
            const phone = String(phoneCounter++);

            // Create delivery boy
            const deliveryBoy = await createDeliveryBoy({
              phone,
              name,
              password,
              areaId: area.id,
            });

            // Authenticate with correct credentials
            const result = await authenticateDeliveryBoy(phone, password);

            // Verify authentication succeeded
            expect(result.isValid).toBe(true);
            expect(result.deliveryBoy).toBeDefined();
            expect(result.deliveryBoy.id).toBe(deliveryBoy.id);
            expect(result.deliveryBoy.phone).toBe(phone);
            expect(result.deliveryBoy.name).toBe(name);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }, 120000);

    it('for any invalid password, authentication should fail', async () => {
      let phoneCounter = 5000000000;
      
      await fc.assert(
        fc.asyncProperty(
          validNameArb,
          validPasswordArb,
          validPasswordArb,
          validAreaNameArb,
          validPincodesArb,
          async (name, correctPassword, wrongPassword, areaName, pincodes) => {
            // Skip if passwords happen to be the same
            if (correctPassword === wrongPassword) {
              return true;
            }

            // Create an area
            const area = await createArea({
              name: areaName,
              pincodes: pincodes,
            });

            // Generate unique phone for this test run
            const phone = String(phoneCounter++);

            // Create delivery boy with correct password
            await createDeliveryBoy({
              phone,
              name,
              password: correctPassword,
              areaId: area.id,
            });

            // Authenticate with wrong password
            const result = await authenticateDeliveryBoy(phone, wrongPassword);

            // Verify authentication failed
            expect(result.isValid).toBe(false);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }, 120000);

    it('for any authenticated delivery boy, today\'s deliveries should be returned', async () => {
      let phoneCounter = 6000000000;
      
      await fc.assert(
        fc.asyncProperty(
          validNameArb,
          validPasswordArb,
          async (name, password) => {
            // Clean up before test
            await prisma.delivery.deleteMany({});
            await prisma.subscriptionProduct.deleteMany({});
            await prisma.subscription.deleteMany({});
            await prisma.address.deleteMany({});
            await prisma.wallet.deleteMany({});
            await prisma.customer.deleteMany({});
            await prisma.deliverySlot.deleteMany({});
            await prisma.deliveryBoy.deleteMany({});
            await prisma.area.deleteMany({});
            await prisma.product.deleteMany({});

            // Create an area
            const area = await createArea({
              name: 'Test Area',
              pincodes: ['440001'],
            });

            // Generate unique phone for this test run
            const phone = String(phoneCounter++);

            // Create delivery boy
            const deliveryBoy = await createDeliveryBoy({
              phone,
              name,
              password,
              areaId: area.id,
            });

            // Create a customer
            const customer = await prisma.customer.create({
              data: {
                phone: '9876543212',
                name: 'Test Customer',
              },
            });

            const address = await prisma.address.create({
              data: {
                customerId: customer.id,
                line1: 'Test Address',
                city: 'Test City',
                state: 'Test State',
                pincode: '440001',
                isDefault: true,
              },
            });

            // Create a delivery slot
            const deliverySlot = await prisma.deliverySlot.create({
              data: {
                startTime: '06:00',
                endTime: '08:00',
                label: 'Morning',
                isActive: true,
              },
            });

            // Create a product
            const product = await prisma.product.create({
              data: {
                name: 'Test Milk',
                description: 'Test milk product',
                price: 50,
                unit: 'litre',
                isAvailable: true,
              },
            });

            // Create a subscription
            const subscription = await prisma.subscription.create({
              data: {
                customerId: customer.id,
                addressId: address.id,
                deliverySlotId: deliverySlot.id,
                frequency: 'DAILY',
                status: 'ACTIVE',
                startDate: new Date(),
              },
            });

            // Add product to subscription
            await prisma.subscriptionProduct.create({
              data: {
                subscriptionId: subscription.id,
                productId: product.id,
                quantity: 2,
                priceAtTime: product.price,
              },
            });

            // Create today's delivery
            await prisma.delivery.create({
              data: {
                subscriptionId: subscription.id,
                deliveryBoyId: deliveryBoy.id,
                deliveryDate: new Date(),
                status: 'PENDING',
              },
            });

            // Authenticate
            const authResult = await authenticateDeliveryBoy(phone, password);
            expect(authResult.isValid).toBe(true);

            // Get today's deliveries
            const deliveries = await getTodayDeliveries(deliveryBoy.id);

            // Verify deliveries are returned
            expect(deliveries).toBeDefined();
            expect(deliveries.length).toBeGreaterThanOrEqual(1);
            expect(deliveries[0].customerName).toBe('Test Customer');
            expect(deliveries[0].products.length).toBe(1);
            expect(deliveries[0].products[0].productName).toBe('Test Milk');
            expect(deliveries[0].products[0].quantity).toBe(2);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }, 120000);
  });

});
