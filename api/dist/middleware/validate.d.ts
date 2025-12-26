import type { Request, Response, NextFunction } from 'express';
import { z, ZodSchema } from 'zod';
interface ValidationSchemas {
    body?: ZodSchema;
    query?: ZodSchema;
    params?: ZodSchema;
}
export declare function validate(schemas: ValidationSchemas): (req: Request, _res: Response, next: NextFunction) => void;
export declare const phoneSchema: z.ZodString;
export declare const uuidSchema: z.ZodString;
export declare const paginationSchema: z.ZodObject<{
    page: z.ZodDefault<z.ZodNumber>;
    limit: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    page: number;
    limit: number;
}, {
    page?: number | undefined;
    limit?: number | undefined;
}>;
export declare const dateRangeSchema: z.ZodObject<{
    startDate: z.ZodOptional<z.ZodDate>;
    endDate: z.ZodOptional<z.ZodDate>;
}, "strip", z.ZodTypeAny, {
    startDate?: Date | undefined;
    endDate?: Date | undefined;
}, {
    startDate?: Date | undefined;
    endDate?: Date | undefined;
}>;
export {};
//# sourceMappingURL=validate.d.ts.map