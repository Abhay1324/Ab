import type { AuthToken, UserProfile } from '@milk-subscription/shared';
import type { JwtPayload } from '../middleware/auth.js';
/**
 * Generates access and refresh tokens for a user
 */
export declare function generateTokens(user: UserProfile): AuthToken;
/**
 * Verifies an access token and returns the payload
 */
export declare function verifyAccessToken(token: string): JwtPayload;
/**
 * Refreshes tokens using a valid refresh token
 */
export declare function refreshTokens(refreshToken: string): Promise<AuthToken>;
/**
 * Invalidates a user session (logout)
 * In a production system, this would add the token to a blacklist
 * For simplicity, we just verify the token is valid
 */
export declare function invalidateSession(token: string): boolean;
/**
 * Creates tokens for a customer after OTP verification
 */
export declare function createCustomerSession(phone: string, customerId?: string): Promise<AuthToken>;
//# sourceMappingURL=token.service.d.ts.map