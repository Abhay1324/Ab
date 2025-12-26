import { Router } from 'express';
import { z } from 'zod';
import { validate, uuidSchema } from '../middleware/validate.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { getCustomerProfile, createCustomerProfile, updateCustomerProfile, addCustomerAddress, updateCustomerAddress, deleteCustomerAddress, getCustomerAddresses, } from '../services/customer.service.js';
const router = Router();
// Validation schemas
const profileSchema = z.object({
    name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
    email: z.string().email('Invalid email format').optional(),
});
const updateProfileSchema = z.object({
    name: z.string().min(1, 'Name is required').max(100, 'Name too long').optional(),
    email: z.string().email('Invalid email format').optional(),
});
const addressSchema = z.object({
    line1: z.string().min(1, 'Address line 1 is required').max(200),
    line2: z.string().max(200).optional(),
    landmark: z.string().max(200).optional(),
    city: z.string().min(1, 'City is required').max(100),
    state: z.string().min(1, 'State is required').max(100),
    pincode: z.string().regex(/^\d{6}$/, 'Pincode must be 6 digits'),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    isDefault: z.boolean().optional(),
});
const updateAddressSchema = addressSchema.partial();
const addressIdParamSchema = z.object({
    addressId: uuidSchema,
});
/**
 * POST /api/customers/profile
 * Create/setup customer profile after registration
 * Requirements: 1.3
 */
router.post('/profile', authenticate, requireRole('customer'), validate({ body: profileSchema }), async (req, res, next) => {
    try {
        const customerId = req.user.userId;
        const profile = await createCustomerProfile(customerId, req.body);
        res.status(201).json({
            success: true,
            data: profile,
        });
    }
    catch (error) {
        next(error);
    }
});
/**
 * GET /api/customers/profile
 * Get current customer's profile
 * Requirements: 1.3
 */
router.get('/profile', authenticate, requireRole('customer'), async (req, res, next) => {
    try {
        const customerId = req.user.userId;
        const profile = await getCustomerProfile(customerId);
        res.json({
            success: true,
            data: profile,
        });
    }
    catch (error) {
        next(error);
    }
});
/**
 * PUT /api/customers/profile
 * Update current customer's profile
 * Requirements: 1.3
 */
router.put('/profile', authenticate, requireRole('customer'), validate({ body: updateProfileSchema }), async (req, res, next) => {
    try {
        const customerId = req.user.userId;
        const profile = await updateCustomerProfile(customerId, req.body);
        res.json({
            success: true,
            data: profile,
        });
    }
    catch (error) {
        next(error);
    }
});
/**
 * POST /api/customers/addresses
 * Add a new address for the customer
 * Requirements: 1.3
 */
router.post('/addresses', authenticate, requireRole('customer'), validate({ body: addressSchema }), async (req, res, next) => {
    try {
        const customerId = req.user.userId;
        const address = await addCustomerAddress(customerId, req.body);
        res.status(201).json({
            success: true,
            data: address,
        });
    }
    catch (error) {
        next(error);
    }
});
/**
 * GET /api/customers/addresses
 * Get all addresses for the customer
 * Requirements: 1.3
 */
router.get('/addresses', authenticate, requireRole('customer'), async (req, res, next) => {
    try {
        const customerId = req.user.userId;
        const addresses = await getCustomerAddresses(customerId);
        res.json({
            success: true,
            data: addresses,
        });
    }
    catch (error) {
        next(error);
    }
});
/**
 * PUT /api/customers/addresses/:addressId
 * Update an existing address
 * Requirements: 1.3
 */
router.put('/addresses/:addressId', authenticate, requireRole('customer'), validate({ params: addressIdParamSchema, body: updateAddressSchema }), async (req, res, next) => {
    try {
        const customerId = req.user.userId;
        const addressId = req.params.addressId;
        const address = await updateCustomerAddress(customerId, addressId, req.body);
        res.json({
            success: true,
            data: address,
        });
    }
    catch (error) {
        next(error);
    }
});
/**
 * DELETE /api/customers/addresses/:addressId
 * Delete an address
 * Requirements: 1.3
 */
router.delete('/addresses/:addressId', authenticate, requireRole('customer'), validate({ params: addressIdParamSchema }), async (req, res, next) => {
    try {
        const customerId = req.user.userId;
        const addressId = req.params.addressId;
        await deleteCustomerAddress(customerId, addressId);
        res.json({
            success: true,
            message: 'Address deleted successfully',
        });
    }
    catch (error) {
        next(error);
    }
});
export default router;
//# sourceMappingURL=customer.routes.js.map