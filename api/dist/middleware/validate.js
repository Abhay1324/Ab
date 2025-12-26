import { z, ZodError } from 'zod';
import { ApiError } from './errorHandler.js';
export function validate(schemas) {
    return (req, _res, next) => {
        try {
            if (schemas.body) {
                req.body = schemas.body.parse(req.body);
            }
            if (schemas.query) {
                req.query = schemas.query.parse(req.query);
            }
            if (schemas.params) {
                req.params = schemas.params.parse(req.params);
            }
            next();
        }
        catch (error) {
            if (error instanceof ZodError) {
                const details = error.errors.map((e) => ({
                    field: e.path.join('.'),
                    message: e.message,
                }));
                next(ApiError.badRequest('VALIDATION_ERROR', 'Invalid request data', details));
            }
            else {
                next(error);
            }
        }
    };
}
// Common validation schemas
export const phoneSchema = z.string().regex(/^[6-9]\d{9}$/, 'Invalid phone number format');
export const uuidSchema = z.string().uuid('Invalid ID format');
export const paginationSchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
});
export const dateRangeSchema = z.object({
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
});
//# sourceMappingURL=validate.js.map