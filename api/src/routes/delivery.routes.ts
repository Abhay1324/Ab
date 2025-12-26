import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { validate, uuidSchema } from '../middleware/validate.js';
import { authenticate, requireRole, type AuthenticatedRequest } from '../middleware/auth.js';
import {
  getTodayDeliveries,
  getOptimizedRoute,
  markDeliveryCompleted,
  markDeliveryFailed,
  startDelivery,
  getDeliveryById,
  getDeliveryHistory,
  getFailureReasonCodes,
} from '../services/delivery.service.js';

const router: RouterType = Router();

// Validation schemas
const deliveryIdParamSchema = z.object({
  id: uuidSchema,
});

const completeDeliverySchema = z.object({
  proof: z.object({
    type: z.enum(['photo', 'signature'], {
      errorMap: () => ({ message: 'Proof type must be photo or signature' }),
    }),
    url: z.string().url('Please provide a valid proof URL'),
  }),
});

const failDeliverySchema = z.object({
  reason: z.object({
    code: z.string().min(1, 'Please select failure reason'),
    notes: z.string().max(500).optional(),
  }),
});

const deliveryHistoryQuerySchema = z.object({
  status: z.enum(['pending', 'in_progress', 'delivered', 'failed']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  limit: z.string().transform(Number).optional(),
  offset: z.string().transform(Number).optional(),
});


/**
 * GET /api/deliveries/failure-reasons
 * Get all valid failure reason codes
 * Requirements: 5.3
 */
router.get(
  '/failure-reasons',
  authenticate,
  requireRole('delivery_boy'),
  async (_req, res, next) => {
    try {
      const reasons = getFailureReasonCodes();

      res.json({
        success: true,
        data: reasons,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/deliveries/today
 * Get today's deliveries for the authenticated delivery boy
 * Requirements: 5.1
 */
router.get(
  '/today',
  authenticate,
  requireRole('delivery_boy'),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const deliveryBoyId = req.user!.userId;
      const deliveries = await getTodayDeliveries(deliveryBoyId);

      res.json({
        success: true,
        data: deliveries,
        count: deliveries.length,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/deliveries/route
 * Get optimized route for today's deliveries
 * Requirements: 5.1
 */
router.get(
  '/route',
  authenticate,
  requireRole('delivery_boy'),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const deliveryBoyId = req.user!.userId;
      const route = await getOptimizedRoute(deliveryBoyId);

      res.json({
        success: true,
        data: route,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/deliveries/history
 * Get delivery history for the authenticated delivery boy
 * Requirements: 5.1
 */
router.get(
  '/history',
  authenticate,
  requireRole('delivery_boy'),
  validate({ query: deliveryHistoryQuerySchema }),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const deliveryBoyId = req.user!.userId;
      const filters = {
        status: req.query.status as any,
        startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
        endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
      };

      const deliveries = await getDeliveryHistory(deliveryBoyId, filters);

      res.json({
        success: true,
        data: deliveries,
        count: deliveries.length,
      });
    } catch (error) {
      next(error);
    }
  }
);


/**
 * GET /api/deliveries/:id
 * Get a specific delivery by ID
 * Requirements: 5.1
 */
router.get(
  '/:id',
  authenticate,
  requireRole('delivery_boy'),
  validate({ params: deliveryIdParamSchema }),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const delivery = await getDeliveryById(req.params.id!);

      // Verify the delivery belongs to this delivery boy
      if (delivery.deliveryBoyId !== req.user!.userId) {
        res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'You do not have access to this delivery',
          },
        });
        return;
      }

      res.json({
        success: true,
        data: delivery,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/deliveries/:id/start
 * Start a delivery (mark as in_progress)
 * Requirements: 5.1
 */
router.post(
  '/:id/start',
  authenticate,
  requireRole('delivery_boy'),
  validate({ params: deliveryIdParamSchema }),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const deliveryBoyId = req.user!.userId;
      const deliveryId = req.params.id!;

      const delivery = await startDelivery(deliveryId, deliveryBoyId);

      res.json({
        success: true,
        data: delivery,
        message: 'Delivery started',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/deliveries/:id/complete
 * Mark a delivery as completed with proof
 * Requirements: 5.2, 5.4
 */
router.post(
  '/:id/complete',
  authenticate,
  requireRole('delivery_boy'),
  validate({ params: deliveryIdParamSchema, body: completeDeliverySchema }),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const deliveryBoyId = req.user!.userId;
      const deliveryId = req.params.id!;
      const { proof } = req.body;

      const delivery = await markDeliveryCompleted(deliveryId, deliveryBoyId, {
        type: proof.type,
        url: proof.url,
        capturedAt: new Date(),
      });

      res.json({
        success: true,
        data: delivery,
        message: 'Delivery completed successfully',
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/deliveries/:id/fail
 * Mark a delivery as failed with reason
 * Requirements: 5.3
 */
router.post(
  '/:id/fail',
  authenticate,
  requireRole('delivery_boy'),
  validate({ params: deliveryIdParamSchema, body: failDeliverySchema }),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const deliveryBoyId = req.user!.userId;
      const deliveryId = req.params.id!;
      const { reason } = req.body;

      const delivery = await markDeliveryFailed(deliveryId, deliveryBoyId, {
        code: reason.code,
        description: '',
        notes: reason.notes,
      });

      res.json({
        success: true,
        data: delivery,
        message: 'Delivery marked as failed',
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
