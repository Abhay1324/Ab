import type { Request, Response, NextFunction } from 'express';
export interface AppError extends Error {
    statusCode?: number;
    code?: string;
    details?: unknown;
}
export declare class ApiError extends Error implements AppError {
    statusCode: number;
    code: string;
    details?: unknown;
    constructor(statusCode: number, code: string, message: string, details?: unknown);
    static badRequest(code: string, message: string, details?: unknown): ApiError;
    static unauthorized(code: string, message: string): ApiError;
    static forbidden(code: string, message: string): ApiError;
    static notFound(code: string, message: string): ApiError;
    static conflict(code: string, message: string): ApiError;
    static internal(message: string): ApiError;
}
export declare function errorHandler(err: AppError, _req: Request, res: Response, _next: NextFunction): void;
//# sourceMappingURL=errorHandler.d.ts.map