import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { validate, uuidSchema } from '../middleware/validate.js';
import { authenticate, requireRole, type AuthenticatedRequest } from '../middleware/auth.js';
import {
  getAvailableProducts,
  getAllProducts,
  getProductById,
  createProduct,
  updateProduct,
  setProductAvailability,
} from '../services/product.service.js';

const router: RouterType = Router();

// Validation schemas
const productSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long'),
  description: z.string().min(1, 'Description is required').max(500, 'Description too long'),
  price: z.number().positive('Price must be positive').max(100000, 'Price too high'),
  unit: z.string().min(1, 'Unit is required').max(50, 'Unit too long'),
  isAvailable: z.boolean().optional(),
});

const updateProductSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name too long').optional(),
  description: z.string().min(1, 'Description is required').max(500, 'Description too long').optional(),
  price: z.number().positive('Price must be positive').max(100000, 'Price too high').optional(),
  unit: z.string().min(1, 'Unit is required').max(50, 'Unit too long').optional(),
  isAvailable: z.boolean().optional(),
});

const productIdParamSchema = z.object({
  id: uuidSchema,
});

const availabilitySchema = z.object({
  isAvailable: z.boolean(),
});


/**
 * GET /api/products
 * Get all available products for subscription
 * Requirements: 9.1
 */
router.get(
  '/',
  async (_req, res, next) => {
    try {
      const products = await getAvailableProducts();
      
      res.json({
        success: true,
        data: products,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/products/:id
 * Get a specific product by ID
 * Requirements: 9.1
 */
router.get(
  '/:id',
  validate({ params: productIdParamSchema }),
  async (req, res, next) => {
    try {
      const product = await getProductById(req.params.id!);
      
      res.json({
        success: true,
        data: product,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/admin/products
 * Get all products (including unavailable) - admin only
 * Requirements: 9.1
 */
router.get(
  '/admin/all',
  authenticate,
  requireRole('admin'),
  async (_req, res, next) => {
    try {
      const products = await getAllProducts();
      
      res.json({
        success: true,
        data: products,
      });
    } catch (error) {
      next(error);
    }
  }
);


/**
 * POST /api/admin/products
 * Create a new product - admin only
 * Requirements: 9.1
 */
router.post(
  '/admin',
  authenticate,
  requireRole('admin'),
  validate({ body: productSchema }),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const product = await createProduct(req.body);
      
      res.status(201).json({
        success: true,
        data: product,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/admin/products/:id
 * Update a product - admin only
 * Price changes only apply to new subscriptions
 * Requirements: 9.2
 */
router.put(
  '/admin/:id',
  authenticate,
  requireRole('admin'),
  validate({ params: productIdParamSchema, body: updateProductSchema }),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const product = await updateProduct(req.params.id!, req.body);
      
      res.json({
        success: true,
        data: product,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/admin/products/:id/availability
 * Set product availability - admin only
 * When set to unavailable, returns affected customer IDs for notification
 * Requirements: 9.3
 */
router.patch(
  '/admin/:id/availability',
  authenticate,
  requireRole('admin'),
  validate({ params: productIdParamSchema, body: availabilitySchema }),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const { product, affectedCustomerIds } = await setProductAvailability(
        req.params.id!,
        req.body.isAvailable
      );
      
      res.json({
        success: true,
        data: {
          product,
          affectedCustomerIds,
          message: affectedCustomerIds.length > 0
            ? `${affectedCustomerIds.length} customers will be notified about product unavailability`
            : undefined,
        },
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
