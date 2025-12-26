/**
 * Property-Based Tests for Customer Module
 * Feature: milk-subscription, Property 2: Profile Persistence
 * Validates: Requirements 1.3
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { prisma } from '../lib/prisma.js';
import {
  getCustomerProfile,
  createCustomerProfile,
  updateCustomerProfile,
  addCustomerAddress,
  getCustomerAddresses,
} from './customer.service.js';

// Arbitrary for valid Indian phone numbers (10 digits starting with 6-9)
const validPhoneArb = fc
  .integer({ min: 6, max: 9 })
  .chain((firstDigit) =>
    fc.integer({ min: 0, max: 999999999 }).map((rest) => {
      const restStr = rest.toString().padStart(9, '0');
      return `${firstDigit}${restStr}`;
    })
  );

// Arbitrary for valid customer names (non-empty, reasonable length)
const validNameArb = fc.string({ minLength: 1, maxLength: 100 }).filter(
  (s) => s.trim().length > 0
);

// Arbitrary for valid email addresses
const validEmailArb = fc.emailAddress();

// Arbitrary for valid pincode (6 digits)
const validPincodeArb = fc.integer({ min: 100000, max: 999999 }).map(String);

// Arbitrary for valid address input
const validAddressArb = fc.record({
  line1: fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.trim().length > 0),
  line2: fc.option(fc.string({ maxLength: 200 }), { nil: undefined }),
  landmark: fc.option(fc.string({ maxLength: 200 }), { nil: undefined }),
  city: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
  state: fc.string({ minLength: 1, maxLength: 100 }).filter((s) => s.trim().length > 0),
  pincode: validPincodeArb,
  latitude: fc.option(fc.double({ min: -90, max: 90, noNaN: true }), { nil: undefined }),
  longitude: fc.option(fc.double({ min: -180, max: 180, noNaN: true }), { nil: undefined }),
  isDefault: fc.option(fc.boolean(), { nil: undefined }),
});

describe('Customer Service', () => {
  beforeAll(async () => {
    await prisma.$connect();
    // Initial cleanup - respect foreign key constraints
    await prisma.delivery.deleteMany({});
    await prisma.subscriptionProduct.deleteMany({});
    await prisma.subscription.deleteMany({});
    await prisma.address.deleteMany({});
    await prisma.wallet.deleteMany({});
    await prisma.customer.deleteMany({});
  });

  afterAll(async () => {
    // Final cleanup - respect foreign key constraints
    await prisma.delivery.deleteMany({});
    await prisma.subscriptionProduct.deleteMany({});
    await prisma.subscription.deleteMany({});
    await prisma.address.deleteMany({});
    await prisma.wallet.deleteMany({});
    await prisma.customer.deleteMany({});
    await prisma.$disconnect();
  });


  /**
   * Property 2: Profile Persistence
   * For any valid customer profile data (name, address, pincode), saving and then
   * retrieving the profile should return equivalent data.
   * Validates: Requirements 1.3
   */
  describe('Property 2: Profile Persistence', () => {
    it('for any valid profile data, saving then retrieving should return equivalent data', async () => {
      await fc.assert(
        fc.asyncProperty(
          validPhoneArb,
          validNameArb,
          fc.option(validEmailArb, { nil: undefined }),
          async (phone, name, email) => {
            // Clean up any existing data for this phone
            await prisma.address.deleteMany({ where: { customer: { phone } } });
            await prisma.wallet.deleteMany({ where: { customer: { phone } } });
            await prisma.customer.deleteMany({ where: { phone } });

            // Step 1: Create a customer (simulating post-OTP registration)
            const customer = await prisma.customer.create({
              data: {
                phone,
                name: '', // Initial empty name
              },
            });

            // Step 2: Create/update profile with provided data
            const profileInput = { name, email };
            await createCustomerProfile(customer.id, profileInput);

            // Step 3: Retrieve the profile
            const retrievedProfile = await getCustomerProfile(customer.id);

            // Step 4: Verify equivalence
            expect(retrievedProfile.name).toBe(name);
            expect(retrievedProfile.email).toBe(email);
            expect(retrievedProfile.phone).toBe(phone);
            expect(retrievedProfile.id).toBe(customer.id);

            // Cleanup - use deleteMany to avoid errors if already deleted
            await prisma.customer.deleteMany({ where: { id: customer.id } });

            return true;
          }
        ),
        { numRuns: 20 }
      );
    }, 60000);

    it('for any valid profile update, changes should persist correctly', async () => {
      await fc.assert(
        fc.asyncProperty(
          validPhoneArb,
          validNameArb,
          validNameArb,
          async (phone, initialName, updatedName) => {
            // Clean up
            await prisma.address.deleteMany({ where: { customer: { phone } } });
            await prisma.wallet.deleteMany({ where: { customer: { phone } } });
            await prisma.customer.deleteMany({ where: { phone } });

            // Create customer with initial name
            const customer = await prisma.customer.create({
              data: { phone, name: initialName },
            });

            // Update profile
            await updateCustomerProfile(customer.id, { name: updatedName });

            // Retrieve and verify
            const retrieved = await getCustomerProfile(customer.id);
            expect(retrieved.name).toBe(updatedName);

            // Cleanup - use deleteMany to avoid errors if already deleted
            await prisma.customer.deleteMany({ where: { id: customer.id } });

            return true;
          }
        ),
        { numRuns: 20 }
      );
    }, 60000);


    it('for any valid address data, saving then retrieving should return equivalent data', async () => {
      await fc.assert(
        fc.asyncProperty(
          validPhoneArb,
          validNameArb,
          validAddressArb,
          async (phone, name, addressInput) => {
            // Clean up
            await prisma.address.deleteMany({ where: { customer: { phone } } });
            await prisma.wallet.deleteMany({ where: { customer: { phone } } });
            await prisma.customer.deleteMany({ where: { phone } });

            // Create customer
            const customer = await prisma.customer.create({
              data: { phone, name },
            });

            // Add address
            await addCustomerAddress(customer.id, addressInput);

            // Retrieve addresses
            const addresses = await getCustomerAddresses(customer.id);

            // Verify the address was saved correctly
            expect(addresses.length).toBe(1);
            const retrieved = addresses[0]!;

            expect(retrieved.line1).toBe(addressInput.line1);
            expect(retrieved.city).toBe(addressInput.city);
            expect(retrieved.state).toBe(addressInput.state);
            expect(retrieved.pincode).toBe(addressInput.pincode);

            // Optional fields
            if (addressInput.line2 !== undefined) {
              expect(retrieved.line2).toBe(addressInput.line2);
            }
            if (addressInput.landmark !== undefined) {
              expect(retrieved.landmark).toBe(addressInput.landmark);
            }

            // First address should be default unless explicitly set to false
            // If isDefault is undefined or true, first address becomes default
            // If isDefault is explicitly false, it stays false
            const expectedDefault = addressInput.isDefault !== false;
            expect(retrieved.isDefault).toBe(expectedDefault);

            // Cleanup - use deleteMany to avoid errors if already deleted
            await prisma.address.deleteMany({ where: { customerId: customer.id } });
            await prisma.customer.deleteMany({ where: { id: customer.id } });

            return true;
          }
        ),
        { numRuns: 20 }
      );
    }, 60000);

    it('for any customer profile with address, getCustomerProfile should include addresses', async () => {
      await fc.assert(
        fc.asyncProperty(
          validPhoneArb,
          validNameArb,
          validAddressArb,
          async (phone, name, addressInput) => {
            // Clean up
            await prisma.address.deleteMany({ where: { customer: { phone } } });
            await prisma.wallet.deleteMany({ where: { customer: { phone } } });
            await prisma.customer.deleteMany({ where: { phone } });

            // Create customer
            const customer = await prisma.customer.create({
              data: { phone, name },
            });

            // Add address
            await addCustomerAddress(customer.id, addressInput);

            // Get full profile
            const profile = await getCustomerProfile(customer.id);

            // Verify profile includes address
            expect(profile.addresses.length).toBe(1);
            expect(profile.addresses[0]!.line1).toBe(addressInput.line1);
            expect(profile.addresses[0]!.pincode).toBe(addressInput.pincode);

            // Cleanup - use deleteMany to avoid errors if already deleted
            await prisma.address.deleteMany({ where: { customerId: customer.id } });
            await prisma.customer.deleteMany({ where: { id: customer.id } });

            return true;
          }
        ),
        { numRuns: 20 }
      );
    }, 60000);
  });
});
