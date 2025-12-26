import twilio from 'twilio';
import { prisma } from '../lib/prisma.js';
import { config } from '../config/index.js';
import { ApiError } from '../middleware/errorHandler.js';
import type { OTPResponse } from '@milk-subscription/shared';

// Log Twilio configuration on startup
console.log('[TWILIO CONFIG] Checking Twilio configuration...');
console.log('[TWILIO CONFIG] Enabled:', config.twilio.enabled);
console.log('[TWILIO CONFIG] Account SID:', config.twilio.accountSid ? `${config.twilio.accountSid.substring(0, 10)}...` : 'NOT SET');
console.log('[TWILIO CONFIG] Auth Token:', config.twilio.authToken ? '***SET***' : 'NOT SET');
console.log('[TWILIO CONFIG] Verify Service SID:', config.twilio.verifyServiceSid ? `${config.twilio.verifyServiceSid.substring(0, 10)}...` : 'NOT SET');

// Initialize Twilio client with validation
let twilioClient: twilio.Twilio | null = null;

if (config.twilio.enabled) {
  if (!config.twilio.accountSid || !config.twilio.authToken || !config.twilio.verifyServiceSid) {
    console.error('[TWILIO ERROR] Twilio is enabled but credentials are missing!');
    console.error('[TWILIO ERROR] Please check your .env file for:');
    console.error('  - TWILIO_ACCOUNT_SID');
    console.error('  - TWILIO_AUTH_TOKEN');
    console.error('  - TWILIO_VERIFY_SERVICE_SID');
  } else {
    try {
      twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);
      console.log('[TWILIO] Client initialized successfully');
    } catch (error: any) {
      console.error('[TWILIO ERROR] Failed to initialize client:', error.message);
    }
  }
}

/**
 * Generates a 6-digit OTP code (for fallback/testing)
 */
export function generateOTPCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Validates phone number format (Indian 10-digit mobile)
 */
export function validatePhone(phone: string): boolean {
  return /^[6-9]\d{9}$/.test(phone);
}

/**
 * Formats phone to E.164 format for Twilio (+91 for India)
 */
function formatPhoneE164(phone: string): string {
  return `+91${phone}`;
}


/**
 * Sends OTP to the given phone number using Twilio Verify
 * Used by Customer App for authentication
 */
export async function sendOTP(phone: string): Promise<OTPResponse> {
  // Validate phone format
  if (!validatePhone(phone)) {
    throw ApiError.badRequest('AUTH_001', 'Please enter valid 10-digit phone number');
  }

  console.log(`[OTP] Sending OTP to phone: ${phone}`);

  // Check if phone is blocked
  const existingOTP = await prisma.oTP.findFirst({
    where: { phone },
    orderBy: { createdAt: 'desc' },
  });

  if (existingOTP?.blockedUntil && existingOTP.blockedUntil > new Date()) {
    const minutesRemaining = Math.ceil(
      (existingOTP.blockedUntil.getTime() - Date.now()) / (1000 * 60)
    );
    console.log(`[OTP] Phone ${phone} is blocked for ${minutesRemaining} minutes`);
    throw ApiError.badRequest(
      'AUTH_004',
      `Too many failed attempts. Try after ${minutesRemaining} minutes`
    );
  }

  // Delete any existing OTPs for this phone
  await prisma.oTP.deleteMany({ where: { phone } });

  const expiresAt = new Date(Date.now() + config.otp.expiryMinutes * 60 * 1000);

  // Use Twilio Verify if enabled and client is available
  if (config.twilio.enabled && twilioClient) {
    console.log(`[TWILIO] Attempting to send OTP via Twilio Verify to ${formatPhoneE164(phone)}`);
    
    try {
      const verification = await twilioClient.verify.v2
        .services(config.twilio.verifyServiceSid)
        .verifications.create({
          to: formatPhoneE164(phone),
          channel: 'sms',
        });

      console.log(`[TWILIO] Verification created successfully`);
      console.log(`[TWILIO] Status: ${verification.status}`);
      console.log(`[TWILIO] SID: ${verification.sid}`);
      console.log(`[TWILIO] Channel: ${verification.channel}`);

      // Store record for tracking attempts (no code stored - Twilio handles it)
      await prisma.oTP.create({
        data: {
          phone,
          code: 'TWILIO_VERIFY', // Placeholder - actual code managed by Twilio
          expiresAt,
          attempts: 0,
        },
      });

      console.log(`[TWILIO] OTP sent successfully to ${phone}`);
    } catch (error: any) {
      console.error('[TWILIO ERROR] Failed to send OTP');
      console.error('[TWILIO ERROR] Error Code:', error.code);
      console.error('[TWILIO ERROR] Error Message:', error.message);
      console.error('[TWILIO ERROR] More Info:', error.moreInfo);
      console.error('[TWILIO ERROR] Status:', error.status);
      console.error('[TWILIO ERROR] Full Error:', JSON.stringify(error, null, 2));
      
      throw ApiError.badRequest('AUTH_SMS_FAILED', `Failed to send OTP: ${error.message}`);
    }
  } else {
    // Fallback: Generate and store OTP locally (for development/testing)
    console.log(`[OTP] Twilio not enabled, using local OTP generation`);
    const code = generateOTPCode();
    
    await prisma.oTP.create({
      data: {
        phone,
        code,
        expiresAt,
        attempts: 0,
      },
    });

    console.log(`[DEV] OTP for ${phone}: ${code}`);
  }

  return {
    success: true,
    expiresIn: config.otp.expiryMinutes * 60,
    attemptsRemaining: config.otp.maxAttempts,
  };
}


/**
 * Verifies OTP for the given phone number using Twilio Verify
 * Used by Customer App for authentication
 */
export async function verifyOTP(
  phone: string,
  code: string
): Promise<{ success: boolean; customerId?: string }> {
  // Validate phone format
  if (!validatePhone(phone)) {
    throw ApiError.badRequest('AUTH_001', 'Please enter valid 10-digit phone number');
  }

  console.log(`[OTP] Verifying OTP for phone: ${phone}`);

  // Find the OTP record for attempt tracking
  const otpRecord = await prisma.oTP.findFirst({
    where: { phone },
    orderBy: { createdAt: 'desc' },
  });

  if (!otpRecord) {
    console.log(`[OTP] No OTP record found for ${phone}`);
    throw ApiError.badRequest('AUTH_002', 'OTP has expired. Please request new OTP');
  }

  // Check if blocked
  if (otpRecord.blockedUntil && otpRecord.blockedUntil > new Date()) {
    const minutesRemaining = Math.ceil(
      (otpRecord.blockedUntil.getTime() - Date.now()) / (1000 * 60)
    );
    console.log(`[OTP] Phone ${phone} is blocked for ${minutesRemaining} minutes`);
    throw ApiError.badRequest(
      'AUTH_004',
      `Too many failed attempts. Try after ${minutesRemaining} minutes`
    );
  }

  // Check if expired
  if (otpRecord.expiresAt < new Date()) {
    console.log(`[OTP] OTP expired for ${phone}`);
    throw ApiError.badRequest('AUTH_002', 'OTP has expired. Please request new OTP');
  }

  let isVerified = false;

  // Use Twilio Verify if enabled
  if (config.twilio.enabled && twilioClient) {
    console.log(`[TWILIO] Verifying OTP via Twilio for ${formatPhoneE164(phone)}`);
    
    try {
      const verificationCheck = await twilioClient.verify.v2
        .services(config.twilio.verifyServiceSid)
        .verificationChecks.create({
          to: formatPhoneE164(phone),
          code: code,
        });

      console.log(`[TWILIO] Verification check response:`);
      console.log(`[TWILIO] Status: ${verificationCheck.status}`);
      console.log(`[TWILIO] Valid: ${verificationCheck.valid}`);
      console.log(`[TWILIO] SID: ${verificationCheck.sid}`);

      isVerified = verificationCheck.status === 'approved';
    } catch (error: any) {
      console.error('[TWILIO ERROR] Failed to verify OTP');
      console.error('[TWILIO ERROR] Error Code:', error.code);
      console.error('[TWILIO ERROR] Error Message:', error.message);
      console.error('[TWILIO ERROR] More Info:', error.moreInfo);
      console.error('[TWILIO ERROR] Status:', error.status);
      console.error('[TWILIO ERROR] Full Error:', JSON.stringify(error, null, 2));
      
      // Treat Twilio errors as verification failures
      isVerified = false;
    }
  } else {
    // Fallback: Local verification
    console.log(`[OTP] Using local verification for ${phone}`);
    isVerified = otpRecord.code === code;
    console.log(`[OTP] Local verification result: ${isVerified}`);
  }

  if (!isVerified) {
    const newAttempts = otpRecord.attempts + 1;
    const attemptsRemaining = config.otp.maxAttempts - newAttempts;
    console.log(`[OTP] Verification failed. Attempts: ${newAttempts}/${config.otp.maxAttempts}`);

    if (newAttempts >= config.otp.maxAttempts) {
      // Block the phone for 15 minutes
      const blockedUntil = new Date(Date.now() + config.otp.blockMinutes * 60 * 1000);
      await prisma.oTP.update({
        where: { id: otpRecord.id },
        data: { attempts: newAttempts, blockedUntil },
      });
      console.log(`[OTP] Phone ${phone} blocked until ${blockedUntil}`);
      throw ApiError.badRequest(
        'AUTH_004',
        `Too many failed attempts. Try after ${config.otp.blockMinutes} minutes`
      );
    }

    // Update attempt count
    await prisma.oTP.update({
      where: { id: otpRecord.id },
      data: { attempts: newAttempts },
    });

    throw ApiError.badRequest(
      'AUTH_003',
      `Incorrect OTP. ${attemptsRemaining} attempts remaining`
    );
  }

  console.log(`[OTP] Verification successful for ${phone}`);

  // OTP verified successfully - delete the OTP record
  await prisma.oTP.delete({ where: { id: otpRecord.id } });

  // Check if customer exists
  const customer = await prisma.customer.findUnique({ where: { phone } });
  console.log(`[OTP] Customer exists: ${!!customer}`);

  return {
    success: true,
    customerId: customer?.id,
  };
}

/**
 * Gets the remaining attempts for a phone number
 */
export async function getOTPStatus(phone: string): Promise<{
  exists: boolean;
  attemptsRemaining: number;
  isBlocked: boolean;
  blockedUntil?: Date;
}> {
  const otpRecord = await prisma.oTP.findFirst({
    where: { phone },
    orderBy: { createdAt: 'desc' },
  });

  if (!otpRecord) {
    return { exists: false, attemptsRemaining: config.otp.maxAttempts, isBlocked: false };
  }

  const isBlocked = otpRecord.blockedUntil ? otpRecord.blockedUntil > new Date() : false;

  return {
    exists: true,
    attemptsRemaining: config.otp.maxAttempts - otpRecord.attempts,
    isBlocked,
    blockedUntil: otpRecord.blockedUntil ?? undefined,
  };
}
