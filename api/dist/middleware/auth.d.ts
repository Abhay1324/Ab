import type { Request, Response, NextFunction } from 'express';
export interface JwtPayload {
    userId: string;
    phone: string;
    role: 'customer' | 'delivery_boy' | 'admin';
}
export interface AuthenticatedRequest extends Request {
    user?: JwtPayload;
}
export declare function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction): void;
export declare function requireRole(...roles: JwtPayload['role'][]): (req: AuthenticatedRequest, res: Response, next: NextFunction) => void;
//# sourceMappingURL=auth.d.ts.map