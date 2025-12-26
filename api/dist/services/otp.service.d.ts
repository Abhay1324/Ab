import type { OTPResponse } from '@milk-subscription/shared';
/**
 * Generates a 6-digit OTP code
 */
export declare function generateOTPCode(): string;
/**
 * Validates phone number format (Indian 10-digit mobile)
 */
export declare function validatePhone(phone: string): boolean;
/**
 * Sends OTP to the given phone number
 * - Validates phone format
 * - Checks if phone is blocked
 * - Creates new OTP record
 */
export declare function sendOTP(phone: string): Promise<OTPResponse>;
/**
 * Verifies OTP for the given phone number
 * - Checks if OTP exists and is not expired
 * - Tracks failed attempts
 * - Blocks after 3 failed attempts for 15 minutes
 */
export declare function verifyOTP(phone: string, code: string): Promise<{
    success: boolean;
    customerId?: string;
}>;
/**
 * Gets the remaining attempts for a phone number
 */
export declare function getOTPStatus(phone: string): Promise<{
    exists: boolean;
    attemptsRemaining: number;
    isBlocked: boolean;
    blockedUntil?: Date;
}>;
//# sourceMappingURL=otp.service.d.ts.map