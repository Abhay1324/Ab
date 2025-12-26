import { prisma } from '../lib/prisma.js';
import { config } from '../config/index.js';
import { ApiError } from '../middleware/errorHandler.js';
/**
 * Generates a 6-digit OTP code
 */
export function generateOTPCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}
/**
 * Validates phone number format (Indian 10-digit mobile)
 */
export function validatePhone(phone) {
    return /^[6-9]\d{9}$/.test(phone);
}
/**
 * Sends OTP to the given phone number
 * - Validates phone format
 * - Checks if phone is blocked
 * - Creates new OTP record
 */
export async function sendOTP(phone) {
    // Validate phone format
    if (!validatePhone(phone)) {
        throw ApiError.badRequest('AUTH_001', 'Please enter valid 10-digit phone number');
    }
    // Check if phone is blocked
    const existingOTP = await prisma.oTP.findFirst({
        where: { phone },
        orderBy: { createdAt: 'desc' },
    });
    if (existingOTP?.blockedUntil && existingOTP.blockedUntil > new Date()) {
        const minutesRemaining = Math.ceil((existingOTP.blockedUntil.getTime() - Date.now()) / (1000 * 60));
        throw ApiError.badRequest('AUTH_004', `Too many failed attempts. Try after ${minutesRemaining} minutes`);
    }
    // Generate new OTP
    const code = generateOTPCode();
    const expiresAt = new Date(Date.now() + config.otp.expiryMinutes * 60 * 1000);
    // Delete any existing OTPs for this phone
    await prisma.oTP.deleteMany({ where: { phone } });
    // Create new OTP record
    await prisma.oTP.create({
        data: {
            phone,
            code,
            expiresAt,
            attempts: 0,
        },
    });
    // In production, send OTP via SMS gateway
    // For development, log the OTP
    if (config.nodeEnv === 'development') {
        console.log(`[DEV] OTP for ${phone}: ${code}`);
    }
    return {
        success: true,
        expiresIn: config.otp.expiryMinutes * 60,
        attemptsRemaining: config.otp.maxAttempts,
    };
}
/**
 * Verifies OTP for the given phone number
 * - Checks if OTP exists and is not expired
 * - Tracks failed attempts
 * - Blocks after 3 failed attempts for 15 minutes
 */
export async function verifyOTP(phone, code) {
    // Validate phone format
    if (!validatePhone(phone)) {
        throw ApiError.badRequest('AUTH_001', 'Please enter valid 10-digit phone number');
    }
    // Find the OTP record
    const otpRecord = await prisma.oTP.findFirst({
        where: { phone },
        orderBy: { createdAt: 'desc' },
    });
    if (!otpRecord) {
        throw ApiError.badRequest('AUTH_002', 'OTP has expired. Please request new OTP');
    }
    // Check if blocked
    if (otpRecord.blockedUntil && otpRecord.blockedUntil > new Date()) {
        const minutesRemaining = Math.ceil((otpRecord.blockedUntil.getTime() - Date.now()) / (1000 * 60));
        throw ApiError.badRequest('AUTH_004', `Too many failed attempts. Try after ${minutesRemaining} minutes`);
    }
    // Check if expired
    if (otpRecord.expiresAt < new Date()) {
        throw ApiError.badRequest('AUTH_002', 'OTP has expired. Please request new OTP');
    }
    // Verify OTP code
    if (otpRecord.code !== code) {
        const newAttempts = otpRecord.attempts + 1;
        const attemptsRemaining = config.otp.maxAttempts - newAttempts;
        if (newAttempts >= config.otp.maxAttempts) {
            // Block the phone for 15 minutes
            const blockedUntil = new Date(Date.now() + config.otp.blockMinutes * 60 * 1000);
            await prisma.oTP.update({
                where: { id: otpRecord.id },
                data: { attempts: newAttempts, blockedUntil },
            });
            throw ApiError.badRequest('AUTH_004', `Too many failed attempts. Try after ${config.otp.blockMinutes} minutes`);
        }
        // Update attempt count
        await prisma.oTP.update({
            where: { id: otpRecord.id },
            data: { attempts: newAttempts },
        });
        throw ApiError.badRequest('AUTH_003', `Incorrect OTP. ${attemptsRemaining} attempts remaining`);
    }
    // OTP verified successfully - delete the OTP record
    await prisma.oTP.delete({ where: { id: otpRecord.id } });
    // Check if customer exists
    const customer = await prisma.customer.findUnique({ where: { phone } });
    return {
        success: true,
        customerId: customer?.id,
    };
}
/**
 * Gets the remaining attempts for a phone number
 */
export async function getOTPStatus(phone) {
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
//# sourceMappingURL=otp.service.js.map