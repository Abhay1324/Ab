import { Router } from 'express';
import { z } from 'zod';
import { validate, phoneSchema } from '../middleware/validate.js';
import { authenticate } from '../middleware/auth.js';
import { sendOTP, verifyOTP } from '../services/otp.service.js';
import { createCustomerSession, refreshTokens, invalidateSession, } from '../services/token.service.js';
const router = Router();
// Validation schemas
const sendOTPSchema = z.object({
    phone: phoneSchema,
});
const verifyOTPSchema = z.object({
    phone: phoneSchema,
    otp: z.string().length(6, 'OTP must be 6 digits').regex(/^\d{6}$/, 'OTP must be numeric'),
});
const refreshTokenSchema = z.object({
    refreshToken: z.string().min(1, 'Refresh token is required'),
});
/**
 * POST /api/auth/send-otp
 * Send OTP to phone number for authentication
 * Requirements: 1.1
 */
router.post('/send-otp', validate({ body: sendOTPSchema }), async (req, res, next) => {
    try {
        const { phone } = req.body;
        const result = await sendOTP(phone);
        res.json({
            success: true,
            data: result,
        });
    }
    catch (error) {
        next(error);
    }
});
/**
 * POST /api/auth/verify-otp
 * Verify OTP and create session
 * Requirements: 1.2
 */
router.post('/verify-otp', validate({ body: verifyOTPSchema }), async (req, res, next) => {
    try {
        const { phone, otp } = req.body;
        // Verify OTP
        const verifyResult = await verifyOTP(phone, otp);
        // Create session
        const authToken = await createCustomerSession(phone, verifyResult.customerId);
        res.json({
            success: true,
            data: {
                ...authToken,
                isNewUser: !verifyResult.customerId,
            },
        });
    }
    catch (error) {
        next(error);
    }
});
/**
 * POST /api/auth/refresh-token
 * Refresh access token using refresh token
 * Requirements: 1.2
 */
router.post('/refresh-token', validate({ body: refreshTokenSchema }), async (req, res, next) => {
    try {
        const { refreshToken } = req.body;
        const authToken = await refreshTokens(refreshToken);
        res.json({
            success: true,
            data: authToken,
        });
    }
    catch (error) {
        next(error);
    }
});
/**
 * POST /api/auth/logout
 * Invalidate current session
 * Requirements: 1.2
 */
router.post('/logout', authenticate, async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        const token = authHeader?.split(' ')[1];
        if (token) {
            invalidateSession(token);
        }
        res.json({
            success: true,
            message: 'Logged out successfully',
        });
    }
    catch (error) {
        next(error);
    }
});
export default router;
//# sourceMappingURL=auth.routes.js.map