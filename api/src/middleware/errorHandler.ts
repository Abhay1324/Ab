import type { Request, Response, NextFunction } from 'express';

export interface AppError extends Error {
  statusCode?: number;
  code?: string;
  details?: unknown;
}

export class ApiError extends Error implements AppError {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(statusCode: number, code: string, message: string, details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.name = 'ApiError';
  }

  static badRequest(code: string, message: string, details?: unknown) {
    return new ApiError(400, code, message, details);
  }

  static unauthorized(code: string, message: string) {
    return new ApiError(401, code, message);
  }

  static forbidden(code: string, message: string) {
    return new ApiError(403, code, message);
  }

  static notFound(code: string, message: string) {
    return new ApiError(404, code, message);
  }

  static conflict(code: string, message: string) {
    return new ApiError(409, code, message);
  }

  static internal(message: string) {
    return new ApiError(500, 'INTERNAL_ERROR', message);
  }
}

export function errorHandler(
  err: AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  const statusCode = err.statusCode || 500;
  const code = err.code || 'INTERNAL_ERROR';
  const message = err.message || 'Something went wrong';

  if (process.env.NODE_ENV === 'development') {
    console.error('Error:', err);
  }

  const response: Record<string, unknown> = {
    success: false,
    error: {
      code,
      message,
    },
  };

  if (err.details) {
    (response.error as Record<string, unknown>).details = err.details;
  }

  res.status(statusCode).json(response);
}
