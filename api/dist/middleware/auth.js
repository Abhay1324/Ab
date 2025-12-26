import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';
import { ApiError } from './errorHandler.js';
export function authenticate(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            throw ApiError.unauthorized('AUTH_005', 'No token provided');
        }
        const token = authHeader.split(' ')[1];
        if (!token) {
            throw ApiError.unauthorized('AUTH_005', 'Invalid token format');
        }
        const decoded = jwt.verify(token, config.jwt.secret);
        req.user = decoded;
        next();
    }
    catch (error) {
        if (error instanceof jwt.TokenExpiredError) {
            next(ApiError.unauthorized('AUTH_005', 'Session expired. Please login again'));
        }
        else if (error instanceof jwt.JsonWebTokenError) {
            next(ApiError.unauthorized('AUTH_005', 'Invalid token'));
        }
        else {
            next(error);
        }
    }
}
export function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.user) {
            next(ApiError.unauthorized('AUTH_005', 'Authentication required'));
            return;
        }
        if (!roles.includes(req.user.role)) {
            next(ApiError.forbidden('AUTH_006', 'Insufficient permissions'));
            return;
        }
        next();
    };
}
//# sourceMappingURL=auth.js.map