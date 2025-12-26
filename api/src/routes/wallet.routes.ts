import { Router, type Router as RouterType } from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { authenticate, requireRole, type AuthenticatedRequest } from '../middleware/auth.js';
import {
  getWalletBalance,
  addMoney,
  getTransactions,
} from '../services/wallet.service.js';

const router: RouterType = Router();

// Validation schemas
const addMoneySchema = z.object({
  amount: z.number().positive('Amount must be greater than 0'),
  paymentMethod: z.string().min(1, 'Payment method is required'),
  paymentReference: z.string().optional(),
});

const transactionFiltersSchema = z.object({
  type: z.enum(['credit', 'debit']).optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

/**
 * GET /api/wallet/balance
 * Get current wallet balance
 * Requirements: 3.1
 */
router.get(
  '/balance',
  authenticate,
  requireRole('customer'),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const customerId = req.user!.userId;
      const balance = await getWalletBalance(customerId);
      
      res.json({
        success: true,
        data: balance,
      });
    } catch (error) {
      next(error);
    }
  }
);


/**
 * POST /api/wallet/add-money
 * Add money to wallet
 * Requirements: 3.1
 */
router.post(
  '/add-money',
  authenticate,
  requireRole('customer'),
  validate({ body: addMoneySchema }),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const customerId = req.user!.userId;
      const { amount, paymentMethod, paymentReference } = req.body;
      
      const transaction = await addMoney(
        customerId,
        amount,
        paymentMethod,
        paymentReference
      );
      
      res.status(201).json({
        success: true,
        data: transaction,
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/wallet/transactions
 * Get wallet transaction history
 * Requirements: 3.1, 3.2, 3.3, 3.4
 */
router.get(
  '/transactions',
  authenticate,
  requireRole('customer'),
  validate({ query: transactionFiltersSchema }),
  async (req: AuthenticatedRequest, res, next) => {
    try {
      const customerId = req.user!.userId;
      const filters = {
        type: req.query.type as 'credit' | 'debit' | undefined,
        startDate: req.query.startDate ? new Date(req.query.startDate as string) : undefined,
        endDate: req.query.endDate ? new Date(req.query.endDate as string) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined,
        offset: req.query.offset ? Number(req.query.offset) : undefined,
      };
      
      const transactions = await getTransactions(customerId, filters);
      
      res.json({
        success: true,
        data: transactions,
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
