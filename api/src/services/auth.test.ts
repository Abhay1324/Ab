/**
 * Property-Based Tests for Authentication Module
 * Feature: milk-subscription, Property 1: Authentication Round-Trip
 * Validates: Requirements 1.1, 1.2
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fc from 'fast-check';
import { prisma } from '../lib/prisma.js';
import {
  sendOTP,
  verifyOTP,
  validatePhone,
  generateOTPCode,
} from './otp.service.js';
import {
  generateTokens,
  verifyAccessToken,
  createCustomerSession,
} from './token.service.js';

// Arbitrary for valid Indian phone numbers (10 digits starting with 6-9)
const validPhoneArb = fc
  .integer({ min: 6, max: 9 })
  .chain((firstDigit) =>
    fc.integer({ min: 0, max: 999999999 }).map((rest) => {
      const restStr = rest.toString().padStart(9, '0');
      return `${firstDigit}${restStr}`;
    })
  );

// Arbitrary for 6-digit OTP codes
const otpCodeArb = fc.integer({ min: 100000, max: 999999 }).map(String);

describe('OTP Service', () => {
  beforeAll(async () => {
    // Ensure database is ready
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Clean up in correct order respecting foreign keys
    await prisma.delivery.deleteMany({});
    await prisma.subscriptionProduct.deleteMany({});
    await prisma.subscription.deleteMany({});
    await prisma.address.deleteMany({});
    await prisma.oTP.deleteMany({});
    await prisma.wallet.deleteMany({});
    await prisma.customer.deleteMany({});
  });

  describe('Phone Validation', () => {
    it('should validate correct Indian phone numbers', () => {
      fc.assert(
        fc.property(validPhoneArb, (phone) => {
          return validatePhone(phone) === true;
        }),
        { numRuns: 100 }
      );
    });

    it('should reject invalid phone numbers', () => {
      // Phone numbers starting with 0-5 are invalid
      const invalidPhoneArb = fc
        .integer({ min: 0, max: 5 })
        .chain((firstDigit) =>
          fc.integer({ min: 0, max: 999999999 }).map((rest) => {
            const restStr = rest.toString().padStart(9, '0');
            return `${firstDigit}${restStr}`;
          })
        );

      fc.assert(
        fc.property(invalidPhoneArb, (phone) => {
          return validatePhone(phone) === false;
        }),
        { numRuns: 100 }
      );
    });
  });

  describe('OTP Generation', () => {
    it('should generate 6-digit OTP codes', () => {
      fc.assert(
        fc.property(fc.constant(null), () => {
          const otp = generateOTPCode();
          return otp.length === 6 && /^\d{6}$/.test(otp);
        }),
        { numRuns: 100 }
      );
    });
  });


  /**
   * Property 1: Authentication Round-Trip
   * For any valid phone number and correct OTP combination, authenticating
   * should create a valid session that can be used to access protected resources.
   * Validates: Requirements 1.1, 1.2
   */
  describe('Property 1: Authentication Round-Trip', () => {
    it('for any valid phone, sendOTP then verifyOTP with correct code should succeed', async () => {
      await fc.assert(
        fc.asyncProperty(validPhoneArb, async (phone) => {
          // Clean up any existing data for this phone
          await prisma.oTP.deleteMany({ where: { phone } });
          await prisma.wallet.deleteMany({
            where: { customer: { phone } },
          });
          await prisma.customer.deleteMany({ where: { phone } });

          // Step 1: Send OTP
          const sendResult = await sendOTP(phone);
          expect(sendResult.success).toBe(true);
          expect(sendResult.attemptsRemaining).toBe(3);

          // Get the OTP code from database (simulating SMS receipt)
          const otpRecord = await prisma.oTP.findFirst({
            where: { phone },
            orderBy: { createdAt: 'desc' },
          });
          expect(otpRecord).not.toBeNull();
          const code = otpRecord!.code;

          // Step 2: Verify OTP
          const verifyResult = await verifyOTP(phone, code);
          expect(verifyResult.success).toBe(true);

          // Step 3: Create session and verify token works
          const authToken = await createCustomerSession(phone, verifyResult.customerId);
          expect(authToken.accessToken).toBeDefined();
          expect(authToken.refreshToken).toBeDefined();
          expect(authToken.user.phone).toBe(phone);

          // Step 4: Verify the access token is valid
          const payload = verifyAccessToken(authToken.accessToken);
          expect(payload.phone).toBe(phone);
          expect(payload.role).toBe('customer');

          // Cleanup
          await prisma.wallet.deleteMany({ where: { customerId: authToken.user.id } });
          await prisma.customer.deleteMany({ where: { phone } });

          return true;
        }),
        { numRuns: 100 }
      );
    }, 120000); // 2 minute timeout for PBT

    it('for any valid phone, wrong OTP should fail and track attempts', async () => {
      await fc.assert(
        fc.asyncProperty(validPhoneArb, otpCodeArb, async (phone, wrongCode) => {
          // Clean up
          await prisma.oTP.deleteMany({ where: { phone } });
          await prisma.wallet.deleteMany({
            where: { customer: { phone } },
          });
          await prisma.customer.deleteMany({ where: { phone } });

          // Send OTP
          await sendOTP(phone);

          // Get actual OTP
          const otpRecord = await prisma.oTP.findFirst({ where: { phone } });
          
          // Only test if wrongCode is different from actual
          if (otpRecord && wrongCode !== otpRecord.code) {
            try {
              await verifyOTP(phone, wrongCode);
              return false; // Should have thrown
            } catch (error: any) {
              expect(error.code).toBe('AUTH_003');
              
              // Verify attempt was tracked
              const updatedOtp = await prisma.oTP.findFirst({ where: { phone } });
              expect(updatedOtp!.attempts).toBe(1);
            }
          }

          // Cleanup
          await prisma.oTP.deleteMany({ where: { phone } });
          return true;
        }),
        { numRuns: 100 }
      );
    }, 120000); // 2 minute timeout for PBT
  });
});

describe('Token Service', () => {
  it('for any valid user profile, generated tokens should be verifiable', () => {
    fc.assert(
      fc.property(
        fc.record({
          id: fc.uuid(),
          phone: validPhoneArb,
          name: fc.string({ minLength: 1, maxLength: 50 }),
          role: fc.constant('customer' as const),
        }),
        (user) => {
          const tokens = generateTokens(user);
          
          // Verify access token
          const payload = verifyAccessToken(tokens.accessToken);
          
          return (
            payload.userId === user.id &&
            payload.phone === user.phone &&
            payload.role === user.role &&
            tokens.expiresAt > new Date()
          );
        }
      ),
      { numRuns: 100 }
    );
  });
});
