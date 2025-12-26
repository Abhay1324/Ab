import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { validate, uuidSchema } from '../middleware/validate.js';
import { authenticate, requireRole, type AuthenticatedRequest } from '../middleware/auth.js';
import {
  createSubscription,
  getSubscription,
  getCustomerSubscriptions,
  updateSubscription,
  pauseSubscription,
  resumeSubscription,
  cancelSubscription,
  getDeliverySlots,
} from '../services/subscription.service.js';

const router: RouterType = Router();

// Validation schemas
const subscriptionProductSchema = z.object({
  productId: uuidSchema,
  quantity: z.number().int().min(1, 'Quantity must be at least 1').max(10, 'Quantity cannot exceed 10'),
});

const createSubscriptionSchema = z.object({
  products: z.array(subscriptionProductSchema).min(1, 'Please select at least one product'),
  frequency: z.enum(['daily', 'alternate', 'weekly'], {
    errorMap: () => ({ message: 'Frequency must be daily, alternate, or weekly' }),
  }),
  deliverySlotId: uuidSchema,
  startDate: z.string().transform((str) => new Date(str)),
});

const updateSubscriptionSchema = z.object({
  products: z.array(subscriptionProductSchema).min(1).optional(),
  frequency: z.enum(['daily', 'alternate', 'weekly']).optional(),
  deliverySlotId: uuidSchema.optional(),
});

const pauseSubscriptionSchema = z.object({
  startDate: z.string().transform((str) => new Date(str)),
  endDate: z.string().transform((str) => new Date(str)),
  reason: z.string().max(500).optional(),
});

const subscriptionIdParamSchema = z.object({
  id: uuidSchema,
});


/**
 * GET /api/subscriptions/delivery-slots
 * Get all available delivery slots
 * Requirements: 2.3
 */
router.get(
  '/delivery-slots',
  authenticate,
  requireRole('customer'),
  async (_req, res, next) => {
    try {
      const slots = await getDeliverySlots();
      
      res.json({
        success: true,
        data: slots,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/subscriptions
 * Create a new subscription
 * Requirements: 2.1, 2.2, 2.3
 */
router.post(
  '/',
  authenticate,
  requireRole('customer'),
  validate({ body: createSubscriptionSchema }),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const customerId = req.user!.userId;
      const subscription = await createSubscription(customerId, req.body);
      
      res.status(201).json({
        success: true,
        data: subscription,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/subscriptions
 * Get all subscriptions for the current customer
 * Requirements: 2.1
 */
router.get(
  '/',
  authenticate,
  requireRole('customer'),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const customerId = req.user!.userId;
      const subscriptions = await getCustomerSubscriptions(customerId);
      
      res.json({
        success: true,
        data: subscriptions,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/subscriptions/:id
 * Get a specific subscription
 * Requirements: 2.1
 */
router.get(
  '/:id',
  authenticate,
  requireRole('customer'),
  validate({ params: subscriptionIdParamSchema }),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const subscription = await getSubscription(req.params.id!);
      
      // Verify ownership
      if (subscription.customerId !== req.user!.userId) {
        res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'You do not have access to this subscription',
          },
        });
        return;
      }
      
      res.json({
        success: true,
        data: subscription,
      });
    } catch (error) {
      next(error);
    }
  }
);


/**
 * PUT /api/subscriptions/:id
 * Update a subscription (applies from next delivery cycle)
 * Requirements: 2.4
 */
router.put(
  '/:id',
  authenticate,
  requireRole('customer'),
  validate({ params: subscriptionIdParamSchema, body: updateSubscriptionSchema }),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const customerId = req.user!.userId;
      const subscriptionId = req.params.id!;
      const subscription = await updateSubscription(subscriptionId, customerId, req.body);
      
      res.json({
        success: true,
        data: subscription,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/subscriptions/:id/pause
 * Pause a subscription for a specified period
 * Requirements: 2.5
 */
router.post(
  '/:id/pause',
  authenticate,
  requireRole('customer'),
  validate({ params: subscriptionIdParamSchema, body: pauseSubscriptionSchema }),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const customerId = req.user!.userId;
      const subscriptionId = req.params.id!;
      const subscription = await pauseSubscription(subscriptionId, customerId, req.body);
      
      res.json({
        success: true,
        data: subscription,
        message: 'Subscription paused successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/subscriptions/:id/resume
 * Resume a paused subscription
 * Requirements: 2.5
 */
router.post(
  '/:id/resume',
  authenticate,
  requireRole('customer'),
  validate({ params: subscriptionIdParamSchema }),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const customerId = req.user!.userId;
      const subscriptionId = req.params.id!;
      const subscription = await resumeSubscription(subscriptionId, customerId);
      
      res.json({
        success: true,
        data: subscription,
        message: 'Subscription resumed successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * DELETE /api/subscriptions/:id
 * Cancel a subscription
 * Requirements: 2.1
 */
router.delete(
  '/:id',
  authenticate,
  requireRole('customer'),
  validate({ params: subscriptionIdParamSchema }),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const customerId = req.user!.userId;
      const subscriptionId = req.params.id!;
      await cancelSubscription(subscriptionId, customerId);
      
      res.json({
        success: true,
        message: 'Subscription cancelled successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
