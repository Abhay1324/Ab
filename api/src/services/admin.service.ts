import { prisma } from '../lib/prisma.js';

export interface DashboardMetrics {
  totalCustomers: number;
  activeSubscriptions: number;
  todayDeliveries: number;
  completedDeliveries: number;
  pendingDeliveries: number;
  failedDeliveries: number;
  totalRevenue: number;
  todayRevenue: number;
}

export interface DateRangeFilter {
  startDate: Date;
  endDate: Date;
}

export const adminService = {
  async getDashboardMetrics(dateRange?: DateRangeFilter): Promise<DashboardMetrics> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const startDate = dateRange?.startDate || today;
    const endDate = dateRange?.endDate || tomorrow;

    const [
      totalCustomers,
      activeSubscriptions,
      todayDeliveriesData,
      revenueData,
    ] = await Promise.all([
      prisma.customer.count(),
      prisma.subscription.count({ where: { status: 'ACTIVE' } }),
      prisma.delivery.groupBy({
        by: ['status'],
        where: {
          deliveryDate: {
            gte: today,
            lt: tomorrow,
          },
        },
        _count: { _all: true },
      }),
      prisma.transaction.aggregate({
        where: {
          type: 'DEBIT',
          createdAt: {
            gte: startDate,
            lt: endDate,
          },
        },
        _sum: { amount: true },
      }),
    ]);


    const deliveryCounts: Record<string, number> = {};
    for (const item of todayDeliveriesData) {
      deliveryCounts[item.status] = item._count._all;
    }

    const totalRevenueResult = await prisma.transaction.aggregate({
      where: { type: 'DEBIT' },
      _sum: { amount: true },
    });

    const totalDeliveries = Object.values(deliveryCounts).reduce((a, b) => a + b, 0);

    return {
      totalCustomers,
      activeSubscriptions,
      todayDeliveries: totalDeliveries,
      completedDeliveries: deliveryCounts['DELIVERED'] || 0,
      pendingDeliveries: deliveryCounts['PENDING'] || 0,
      failedDeliveries: deliveryCounts['FAILED'] || 0,
      totalRevenue: totalRevenueResult._sum.amount || 0,
      todayRevenue: revenueData._sum.amount || 0,
    };
  },

  async searchCustomers(query: string, page = 1, limit = 10) {
    const skip = (page - 1) * limit;
    
    const where = query
      ? {
          OR: [
            { name: { contains: query } },
            { phone: { contains: query } },
            { email: { contains: query } },
          ],
        }
      : {};

    const [customers, total] = await Promise.all([
      prisma.customer.findMany({
        where,
        skip,
        take: limit,
        include: {
          wallet: true,
          subscriptions: {
            include: { products: { include: { product: true } } },
          },
          addresses: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.customer.count({ where }),
    ]);

    return {
      customers,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },


  async getCustomerById(customerId: string) {
    return prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        wallet: {
          include: {
            transactions: {
              orderBy: { createdAt: 'desc' },
              take: 20,
            },
          },
        },
        subscriptions: {
          include: { products: { include: { product: true } } },
        },
        addresses: true,
      },
    });
  },

  async updateCustomerSubscription(
    customerId: string,
    subscriptionId: string,
    data: { quantity?: number; frequency?: string; status?: string }
  ) {
    const subscription = await prisma.subscription.findFirst({
      where: { id: subscriptionId, customerId },
    });

    if (!subscription) {
      throw new Error('Subscription not found');
    }

    return prisma.subscription.update({
      where: { id: subscriptionId },
      data: {
        ...(data.frequency && { frequency: data.frequency }),
        ...(data.status && { status: data.status }),
      },
      include: { products: { include: { product: true } } },
    });
  },

  async adjustWalletBalance(
    customerId: string,
    amount: number,
    reason: string,
    adminId: string
  ) {
    const wallet = await prisma.wallet.findUnique({
      where: { customerId },
    });

    if (!wallet) {
      throw new Error('Wallet not found');
    }

    const type = amount >= 0 ? 'CREDIT' : 'DEBIT';
    const absoluteAmount = Math.abs(amount);

    if (type === 'DEBIT' && wallet.balance < absoluteAmount) {
      throw new Error('Insufficient balance for debit adjustment');
    }

    const newBalance = type === 'CREDIT' 
      ? wallet.balance + absoluteAmount 
      : wallet.balance - absoluteAmount;

    const [updatedWallet, transaction] = await prisma.$transaction([
      prisma.wallet.update({
        where: { customerId },
        data: { balance: newBalance },
      }),
      prisma.transaction.create({
        data: {
          walletId: wallet.id,
          amount: absoluteAmount,
          type,
          balanceAfter: newBalance,
          reason: `Admin adjustment: ${reason} (by admin: ${adminId})`,
        },
      }),
    ]);

    return { wallet: updatedWallet, transaction };
  },


  async getDeliveryBoys(page = 1, limit = 10) {
    const skip = (page - 1) * limit;

    const [deliveryBoys, total] = await Promise.all([
      prisma.deliveryBoy.findMany({
        skip,
        take: limit,
        include: { area: true },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.deliveryBoy.count(),
    ]);

    return {
      deliveryBoys,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  async createDeliveryBoy(data: {
    name: string;
    phone: string;
    password: string;
    areaId: string;
  }) {
    return prisma.deliveryBoy.create({ 
      data,
      include: { area: true },
    });
  },

  async updateDeliveryBoy(
    id: string,
    data: {
      name?: string;
      phone?: string;
      password?: string;
      areaId?: string;
      isActive?: boolean;
    }
  ) {
    return prisma.deliveryBoy.update({
      where: { id },
      data,
      include: { area: true },
    });
  },

  async getDeliveryAnalytics(dateRange?: DateRangeFilter) {
    const startDate = dateRange?.startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const endDate = dateRange?.endDate || new Date();

    const deliveries = await prisma.delivery.groupBy({
      by: ['status'],
      where: {
        deliveryDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      _count: { _all: true },
    });

    const summary: Record<string, number> = {};
    for (const item of deliveries) {
      summary[item.status] = item._count._all;
    }

    return { summary };
  },
};
