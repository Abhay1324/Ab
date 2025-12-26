export class ApiError extends Error {
    statusCode;
    code;
    details;
    constructor(statusCode, code, message, details) {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.details = details;
        this.name = 'ApiError';
    }
    static badRequest(code, message, details) {
        return new ApiError(400, code, message, details);
    }
    static unauthorized(code, message) {
        return new ApiError(401, code, message);
    }
    static forbidden(code, message) {
        return new ApiError(403, code, message);
    }
    static notFound(code, message) {
        return new ApiError(404, code, message);
    }
    static conflict(code, message) {
        return new ApiError(409, code, message);
    }
    static internal(message) {
        return new ApiError(500, 'INTERNAL_ERROR', message);
    }
}
export function errorHandler(err, _req, res, _next) {
    const statusCode = err.statusCode || 500;
    const code = err.code || 'INTERNAL_ERROR';
    const message = err.message || 'Something went wrong';
    if (process.env.NODE_ENV === 'development') {
        console.error('Error:', err);
    }
    const response = {
        success: false,
        error: {
            code,
            message,
        },
    };
    if (err.details) {
        response.error.details = err.details;
    }
    res.status(statusCode).json(response);
}
//# sourceMappingURL=errorHandler.js.map