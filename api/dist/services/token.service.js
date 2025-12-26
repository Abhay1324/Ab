import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { config } from '../config/index.js';
import { ApiError } from '../middleware/errorHandler.js';
/**
 * Generates access and refresh tokens for a user
 */
export function generateTokens(user) {
    const payload = {
        userId: user.id,
        phone: user.phone,
        role: user.role,
    };
    const accessToken = jwt.sign(payload, config.jwt.secret, {
        expiresIn: config.jwt.accessExpiry,
    });
    const refreshToken = jwt.sign(payload, config.jwt.refreshSecret, {
        expiresIn: config.jwt.refreshExpiry,
    });
    // Calculate expiry time
    const decoded = jwt.decode(accessToken);
    const expiresAt = new Date(decoded.exp * 1000);
    return {
        accessToken,
        refreshToken,
        expiresAt,
        user,
    };
}
/**
 * Verifies an access token and returns the payload
 */
export function verifyAccessToken(token) {
    try {
        return jwt.verify(token, config.jwt.secret);
    }
    catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            throw ApiError.unauthorized('AUTH_005', 'Session expired. Please login again');
        }
        throw ApiError.unauthorized('AUTH_005', 'Invalid token');
    }
}
/**
 * Refreshes tokens using a valid refresh token
 */
export async function refreshTokens(refreshToken) {
    try {
        const payload = jwt.verify(refreshToken, config.jwt.refreshSecret);
        // Fetch user based on role
        let user = null;
        if (payload.role === 'customer') {
            const customer = await prisma.customer.findUnique({
                where: { id: payload.userId },
            });
            if (customer && customer.isActive) {
                user = {
                    id: customer.id,
                    phone: customer.phone,
                    name: customer.name,
                    email: customer.email ?? undefined,
                    role: 'customer',
                };
            }
        }
        else if (payload.role === 'delivery_boy') {
            const deliveryBoy = await prisma.deliveryBoy.findUnique({
                where: { id: payload.userId },
            });
            if (deliveryBoy && deliveryBoy.isActive) {
                user = {
                    id: deliveryBoy.id,
                    phone: deliveryBoy.phone,
                    name: deliveryBoy.name,
                    role: 'delivery_boy',
                };
            }
        }
        else if (payload.role === 'admin') {
            const admin = await prisma.admin.findUnique({
                where: { id: payload.userId },
            });
            if (admin && admin.isActive) {
                user = {
                    id: admin.id,
                    phone: admin.email, // Admin uses email as identifier
                    name: admin.name,
                    role: 'admin',
                };
            }
        }
        if (!user) {
            throw ApiError.unauthorized('AUTH_005', 'User not found or inactive');
        }
        return generateTokens(user);
    }
    catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            throw ApiError.unauthorized('AUTH_005', 'Refresh token expired. Please login again');
        }
        if (error instanceof ApiError) {
            throw error;
        }
        throw ApiError.unauthorized('AUTH_005', 'Invalid refresh token');
    }
}
/**
 * Invalidates a user session (logout)
 * In a production system, this would add the token to a blacklist
 * For simplicity, we just verify the token is valid
 */
export function invalidateSession(token) {
    try {
        jwt.verify(token, config.jwt.secret);
        // In production: add token to Redis blacklist
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Creates tokens for a customer after OTP verification
 */
export async function createCustomerSession(phone, customerId) {
    let user;
    if (customerId) {
        // Existing customer
        const customer = await prisma.customer.findUnique({
            where: { id: customerId },
        });
        if (!customer) {
            throw ApiError.notFound('AUTH_005', 'Customer not found');
        }
        user = {
            id: customer.id,
            phone: customer.phone,
            name: customer.name,
            email: customer.email ?? undefined,
            role: 'customer',
        };
    }
    else {
        // New customer - create with minimal data
        const customer = await prisma.customer.create({
            data: {
                phone,
                name: '', // Will be updated during profile setup
            },
        });
        // Create wallet for new customer
        await prisma.wallet.create({
            data: {
                customerId: customer.id,
                balance: 0,
                minimumThreshold: config.wallet.minimumThreshold,
            },
        });
        user = {
            id: customer.id,
            phone: customer.phone,
            name: customer.name,
            role: 'customer',
        };
    }
    return generateTokens(user);
}
//# sourceMappingURL=token.service.js.map