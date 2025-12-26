import { Router, type Router as RouterType } from 'express';
import authRoutes from './auth.routes.js';
import customerRoutes from './customer.routes.js';
import productRoutes from './product.routes.js';
import subscriptionRoutes from './subscription.routes.js';
import walletRoutes from './wallet.routes.js';
import deliveryRoutes from './delivery.routes.js';
import adminRoutes from './admin.routes.js';

const router: RouterType = Router();

router.use('/auth', authRoutes);
router.use('/customers', customerRoutes);
router.use('/products', productRoutes);
router.use('/subscriptions', subscriptionRoutes);
router.use('/wallet', walletRoutes);
router.use('/deliveries', deliveryRoutes);
router.use('/admin', adminRoutes);

export default router;
