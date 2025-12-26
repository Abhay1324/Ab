import { Router, type Router as RouterType, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { authenticate, type AuthenticatedRequest } from '../middleware/auth.js';
import { adminService } from '../services/admin.service.js';

const router: RouterType = Router();

// All admin routes require authentication
router.use(authenticate);

// Validation schemas
const dateRangeSchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});

const paginationSchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).optional(),
  limit: z.string().regex(/^\d+$/).transform(Number).optional(),
  query: z.string().optional(),
});

const updateSubscriptionSchema = z.object({
  quantity: z.number().int().positive().optional(),
  frequency: z.enum(['DAILY', 'ALTERNATE', 'WEEKLY', 'CUSTOM']).optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'CANCELLED']).optional(),
});

const walletAdjustSchema = z.object({
  amount: z.number().refine(val => val !== 0, 'Amount cannot be zero'),
  reason: z.string().min(1, 'Reason is required'),
});

const createDeliveryBoySchema = z.object({
  name: z.string().min(1, 'Name is required'),
  phone: z.string().regex(/^\d{10}$/, 'Phone must be 10 digits'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  areaId: z.string().uuid('Area ID must be a valid UUID'),
});

const updateDeliveryBoySchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().regex(/^\d{10}$/).optional(),
  password: z.string().min(6).optional(),
  areaId: z.string().uuid().optional(),
  isActive: z.boolean().optional(),
});

/**
 * GET /api/admin/dashboard
 * Get dashboard metrics with optional date range filter
 * Requirements: 6.1, 6.3
 */
router.get(
  '/dashboard',
  validate({ query: dateRangeSchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { startDate, endDate } = req.query;
      const dateRange = startDate && endDate
        ? { startDate: new Date(startDate as string), endDate: new Date(endDate as string) }
        : undefined;
      
      const metrics = await adminService.getDashboardMetrics(dateRange);
      res.json({ success: true, data: metrics });
    } catch (error) {
      next(error);
    }
  }
);


/**
 * GET /api/admin/customers
 * Search and list customers with pagination
 * Requirements: 7.1
 */
router.get(
  '/customers',
  validate({ query: paginationSchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { query, page, limit } = req.query;
      const result = await adminService.searchCustomers(
        (query as string) || '',
        Number(page) || 1,
        Number(limit) || 10
      );
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/admin/customers/:id
 * Get customer details with subscriptions, wallet, and delivery history
 * Requirements: 7.1
 */
router.get(
  '/customers/:id',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = req.params.id;
      if (!customerId) {
        res.status(400).json({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'Customer ID is required' },
        });
        return;
      }
      const customer = await adminService.getCustomerById(customerId);
      if (!customer) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Customer not found' },
        });
        return;
      }
      res.json({ success: true, data: customer });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/admin/customers/:id/subscription/:subscriptionId
 * Update customer subscription
 * Requirements: 7.2
 */
router.put(
  '/customers/:id/subscription/:subscriptionId',
  validate({ body: updateSubscriptionSchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const customerId = req.params.id;
      const subscriptionId = req.params.subscriptionId;
      
      if (!customerId || !subscriptionId) {
        res.status(400).json({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'Customer ID and Subscription ID are required' },
        });
        return;
      }
      
      const subscription = await adminService.updateCustomerSubscription(
        customerId,
        subscriptionId,
        req.body
      );
      res.json({ success: true, data: subscription });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/admin/customers/:id/wallet/adjust
 * Adjust customer wallet balance with audit trail
 * Requirements: 7.3
 */
router.post(
  '/customers/:id/wallet/adjust',
  validate({ body: walletAdjustSchema }),
  async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    try {
      const { amount, reason } = req.body;
      const adminId = req.user?.userId || 'system';
      const customerId = req.params.id;
      
      if (!customerId) {
        res.status(400).json({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'Customer ID is required' },
        });
        return;
      }
      
      const result = await adminService.adjustWalletBalance(
        customerId,
        amount,
        reason,
        adminId
      );
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);


/**
 * GET /api/admin/delivery-boys
 * List all delivery boys with pagination
 * Requirements: 8.1
 */
router.get(
  '/delivery-boys',
  validate({ query: paginationSchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, limit } = req.query;
      const result = await adminService.getDeliveryBoys(
        Number(page) || 1,
        Number(limit) || 10
      );
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/admin/delivery-boys
 * Create a new delivery boy
 * Requirements: 8.1
 */
router.post(
  '/delivery-boys',
  validate({ body: createDeliveryBoySchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deliveryBoy = await adminService.createDeliveryBoy(req.body);
      res.status(201).json({ success: true, data: deliveryBoy });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/admin/delivery-boys/:id
 * Update delivery boy details
 * Requirements: 8.2, 8.3
 */
router.put(
  '/delivery-boys/:id',
  validate({ body: updateDeliveryBoySchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const deliveryBoyId = req.params.id;
      if (!deliveryBoyId) {
        res.status(400).json({
          success: false,
          error: { code: 'BAD_REQUEST', message: 'Delivery boy ID is required' },
        });
        return;
      }
      const deliveryBoy = await adminService.updateDeliveryBoy(deliveryBoyId, req.body);
      res.json({ success: true, data: deliveryBoy });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/admin/analytics/deliveries
 * Get delivery analytics with date range
 * Requirements: 6.1
 */
router.get(
  '/analytics/deliveries',
  validate({ query: dateRangeSchema }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { startDate, endDate } = req.query;
      const dateRange = startDate && endDate
        ? { startDate: new Date(startDate as string), endDate: new Date(endDate as string) }
        : undefined;
      
      const analytics = await adminService.getDeliveryAnalytics(dateRange);
      res.json({ success: true, data: analytics });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
