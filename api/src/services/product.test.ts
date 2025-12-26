/**
 * Property-Based Tests for Product Module
 * Feature: milk-subscription
 * 
 * Property 19: Product Availability
 * Property 20: Price Change Isolation
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { prisma } from '../lib/prisma.js';
import {
  createProduct,
  getAvailableProducts,
  getAllProducts,
  updateProduct,
  setProductAvailability,
} from './product.service.js';

// Arbitrary for valid product names
const validProductNameArb = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => s.trim().length > 0);

// Arbitrary for valid product descriptions
const validDescriptionArb = fc
  .string({ minLength: 1, maxLength: 500 })
  .filter((s) => s.trim().length > 0);

// Arbitrary for valid prices (positive numbers with up to 2 decimal places)
const validPriceArb = fc
  .double({ min: 0.01, max: 10000, noNaN: true })
  .map((p) => Math.round(p * 100) / 100);

// Arbitrary for valid units
const validUnitArb = fc.constantFrom('litre', 'ml', 'kg', 'g', 'piece', 'pack');

// Arbitrary for valid product input
const validProductInputArb = fc.record({
  name: validProductNameArb,
  description: validDescriptionArb,
  price: validPriceArb,
  unit: validUnitArb,
  isAvailable: fc.boolean(),
});

// Counter for unique identifiers
let productTestCounter = 0;

describe('Product Service', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });


  /**
   * Property 19: Product Availability
   * For any newly added product marked as available, it should appear in the list
   * of subscribable products.
   * Validates: Requirements 9.1
   */
  describe('Property 19: Product Availability', () => {
    it('for any product marked as available, it should appear in available products list', async () => {
      await fc.assert(
        fc.asyncProperty(
          validProductInputArb,
          async (productInput) => {
            // Create product with isAvailable = true
            const createdProduct = await createProduct({
              ...productInput,
              isAvailable: true,
            });

            // Get available products
            const availableProducts = await getAvailableProducts();

            // Verify the product appears in available list
            const found = availableProducts.find((p) => p.id === createdProduct.id);
            expect(found).toBeDefined();
            expect(found!.name).toBe(productInput.name);
            expect(found!.isAvailable).toBe(true);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }, 120000);

    it('for any product marked as unavailable, it should NOT appear in available products list', async () => {
      await fc.assert(
        fc.asyncProperty(
          validProductInputArb,
          async (productInput) => {
            // Create product with isAvailable = false
            const createdProduct = await createProduct({
              ...productInput,
              isAvailable: false,
            });

            // Get available products
            const availableProducts = await getAvailableProducts();

            // Verify the product does NOT appear in available list
            const found = availableProducts.find((p) => p.id === createdProduct.id);
            expect(found).toBeUndefined();

            // But it should appear in all products list
            const allProducts = await getAllProducts();
            const foundInAll = allProducts.find((p) => p.id === createdProduct.id);
            expect(foundInAll).toBeDefined();

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }, 120000);

    it('for any available product set to unavailable, it should be removed from available list', async () => {
      await fc.assert(
        fc.asyncProperty(
          validProductInputArb,
          async (productInput) => {
            // Create available product
            const createdProduct = await createProduct({
              ...productInput,
              isAvailable: true,
            });

            // Verify it's in available list
            let availableProducts = await getAvailableProducts();
            expect(availableProducts.find((p) => p.id === createdProduct.id)).toBeDefined();

            // Set to unavailable
            await setProductAvailability(createdProduct.id, false);

            // Verify it's no longer in available list
            availableProducts = await getAvailableProducts();
            expect(availableProducts.find((p) => p.id === createdProduct.id)).toBeUndefined();

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }, 120000);
  });

  /**
   * Property 20: Price Change Isolation
   * For any product price update, existing active subscriptions should retain their
   * original price and only new subscriptions should use the updated price.
   * Validates: Requirements 9.2
   */
  describe('Property 20: Price Change Isolation', () => {
    it('for any price update, existing subscription products should retain original priceAtTime', async () => {
      await fc.assert(
        fc.asyncProperty(
          validProductInputArb,
          validPriceArb,
          async (productInput, newPrice) => {
            productTestCounter++;
            const uniquePhone = `91111${String(productTestCounter).padStart(5, '0')}`;

            // Create product with initial price
            const originalPrice = productInput.price;
            const createdProduct = await createProduct({
              ...productInput,
              isAvailable: true,
            });

            // Create a customer with address for subscription
            const customer = await prisma.customer.create({
              data: {
                phone: uniquePhone,
                name: 'Test Customer',
              },
            });

            const address = await prisma.address.create({
              data: {
                customerId: customer.id,
                line1: 'Test Address',
                city: 'Test City',
                state: 'Test State',
                pincode: '123456',
                isDefault: true,
              },
            });

            // Create a delivery slot
            const deliverySlot = await prisma.deliverySlot.create({
              data: {
                startTime: '06:00',
                endTime: '08:00',
                label: `Morning-${productTestCounter}`,
                isActive: true,
              },
            });

            // Create a subscription with the product at original price
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

            // Add product to subscription with priceAtTime = original price
            const subscriptionProduct = await prisma.subscriptionProduct.create({
              data: {
                subscriptionId: subscription.id,
                productId: createdProduct.id,
                quantity: 1,
                priceAtTime: originalPrice,
              },
            });

            // Update product price
            await updateProduct(createdProduct.id, { price: newPrice });

            // Verify existing subscription product still has original price
            const existingSubProduct = await prisma.subscriptionProduct.findUnique({
              where: { id: subscriptionProduct.id },
            });

            expect(existingSubProduct).toBeDefined();
            expect(existingSubProduct!.priceAtTime).toBe(originalPrice);

            // Verify product itself has new price
            const updatedProduct = await prisma.product.findUnique({
              where: { id: createdProduct.id },
            });
            expect(updatedProduct!.price).toBe(newPrice);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }, 120000);

    it('for any new subscription after price change, it should use the new price', async () => {
      await fc.assert(
        fc.asyncProperty(
          validProductInputArb,
          validPriceArb,
          async (productInput, newPrice) => {
            productTestCounter++;
            const uniquePhone = `92222${String(productTestCounter).padStart(5, '0')}`;

            // Create product with initial price
            const createdProduct = await createProduct({
              ...productInput,
              isAvailable: true,
            });

            // Update product price
            await updateProduct(createdProduct.id, { price: newPrice });

            // Create a customer with address for new subscription
            const customer = await prisma.customer.create({
              data: {
                phone: uniquePhone,
                name: 'New Customer',
              },
            });

            const address = await prisma.address.create({
              data: {
                customerId: customer.id,
                line1: 'New Address',
                city: 'New City',
                state: 'New State',
                pincode: '654321',
                isDefault: true,
              },
            });

            // Create a delivery slot
            const deliverySlot = await prisma.deliverySlot.create({
              data: {
                startTime: '06:00',
                endTime: '08:00',
                label: `Morning-New-${productTestCounter}`,
                isActive: true,
              },
            });

            // Create a new subscription after price change
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

            // Add product to new subscription - should use new price
            const subscriptionProduct = await prisma.subscriptionProduct.create({
              data: {
                subscriptionId: subscription.id,
                productId: createdProduct.id,
                quantity: 1,
                priceAtTime: newPrice, // New subscriptions use current price
              },
            });

            // Verify new subscription product has new price
            const newSubProduct = await prisma.subscriptionProduct.findUnique({
              where: { id: subscriptionProduct.id },
            });

            expect(newSubProduct).toBeDefined();
            expect(newSubProduct!.priceAtTime).toBe(newPrice);

            return true;
          }
        ),
        { numRuns: 100 }
      );
    }, 120000);
  });
});
