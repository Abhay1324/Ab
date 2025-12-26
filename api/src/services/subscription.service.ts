import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errorHandler.js';
import type { 
  Subscription, 
  SubscriptionInput, 
  SubscriptionProduct,
  DeliveryFrequency,
  PauseInput 
} from '@milk-subscription/shared';

/**
 * Subscription Service
 * Handles subscription creation, modification, pause/resume, and delivery scheduling
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5
 */

export interface SubscriptionProductWithPrice extends SubscriptionProduct {
  priceAtTime: number;
}

export interface SubscriptionWithProducts extends Subscription {
  products: SubscriptionProductWithPrice[];
}

/**
 * Transforms a Prisma subscription to the shared Subscription type
 */
function transformSubscription(subscription: any): SubscriptionWithProducts {
  return {
    id: subscription.id,
    customerId: subscription.customerId,
    addressId: subscription.addressId,
    deliverySlotId: subscription.deliverySlotId,
    frequency: subscription.frequency.toLowerCase() as DeliveryFrequency,
    status: subscription.status.toLowerCase() as 'active' | 'paused' | 'cancelled',
    startDate: subscription.startDate,
    pauseStart: subscription.pauseStart ?? undefined,
    pauseEnd: subscription.pauseEnd ?? undefined,
    createdAt: subscription.createdAt,
    products: subscription.products?.map((p: any) => ({
      productId: p.productId,
      quantity: p.quantity,
      priceAtTime: p.priceAtTime,
    })) ?? [],
  };
}

/**
 * Generates delivery dates based on frequency from start date
 * Requirements: 2.2
 */
export function generateDeliveryDates(
  startDate: Date,
  frequency: DeliveryFrequency,
  count: number,
  pauseStart?: Date,
  pauseEnd?: Date
): Date[] {
  const dates: Date[] = [];
  let currentDate = new Date(startDate);
  currentDate.setHours(0, 0, 0, 0);

  const intervalDays = frequency === 'daily' ? 1 : frequency === 'alternate' ? 2 : 7;

  while (dates.length < count) {
    // Check if current date is within pause period
    const isInPausePeriod = pauseStart && pauseEnd && 
      currentDate >= new Date(pauseStart) && 
      currentDate <= new Date(pauseEnd);

    if (!isInPausePeriod) {
      dates.push(new Date(currentDate));
    }

    // Move to next potential delivery date
    currentDate.setDate(currentDate.getDate() + intervalDays);
  }

  return dates;
}

/**
 * Checks if a date is within pause period
 * Requirements: 2.5
 */
export function isDateInPausePeriod(
  date: Date,
  pauseStart?: Date | null,
  pauseEnd?: Date | null
): boolean {
  if (!pauseStart || !pauseEnd) return false;
  
  const checkDate = new Date(date);
  checkDate.setHours(0, 0, 0, 0);
  
  const start = new Date(pauseStart);
  start.setHours(0, 0, 0, 0);
  
  const end = new Date(pauseEnd);
  end.setHours(0, 0, 0, 0);
  
  return checkDate >= start && checkDate <= end;
}


/**
 * Creates a new subscription with products
 * Requirements: 2.1, 2.2, 2.3
 */
export async function createSubscription(
  customerId: string,
  data: SubscriptionInput
): Promise<SubscriptionWithProducts> {
  // Validate customer exists
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
  });

  if (!customer) {
    throw ApiError.notFound('CUST_001', 'Customer not found');
  }

  // Validate products
  if (!data.products || data.products.length === 0) {
    throw ApiError.badRequest('SUB_001', 'Please select at least one product');
  }

  // Validate quantities
  for (const product of data.products) {
    if (product.quantity < 1 || product.quantity > 10) {
      throw ApiError.badRequest('SUB_002', 'Quantity must be between 1 and 10');
    }
  }

  // Validate delivery slot exists and is active
  const deliverySlot = await prisma.deliverySlot.findUnique({
    where: { id: data.deliverySlotId },
  });

  if (!deliverySlot || !deliverySlot.isActive) {
    throw ApiError.badRequest('SUB_003', 'Selected delivery slot is not available');
  }

  // Get customer's default address if not specified
  const address = await prisma.address.findFirst({
    where: { customerId, isDefault: true },
  });

  if (!address) {
    throw ApiError.badRequest('SUB_006', 'Please add a delivery address first');
  }

  // Fetch product details and validate availability
  const productIds = data.products.map(p => p.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, isAvailable: true },
  });

  if (products.length !== productIds.length) {
    throw ApiError.badRequest('SUB_007', 'One or more selected products are not available');
  }

  // Create product map for price lookup
  const productMap = new Map(products.map(p => [p.id, p]));

  // Create subscription with products in a transaction
  const subscription = await prisma.$transaction(async (tx) => {
    const sub = await tx.subscription.create({
      data: {
        customerId,
        addressId: address.id,
        deliverySlotId: data.deliverySlotId,
        frequency: data.frequency.toUpperCase(),
        status: 'ACTIVE',
        startDate: new Date(data.startDate),
      },
    });

    // Create subscription products with price at time of subscription
    await tx.subscriptionProduct.createMany({
      data: data.products.map(p => ({
        subscriptionId: sub.id,
        productId: p.productId,
        quantity: p.quantity,
        priceAtTime: productMap.get(p.productId)!.price,
      })),
    });

    // Fetch complete subscription with products
    return tx.subscription.findUnique({
      where: { id: sub.id },
      include: { products: true },
    });
  });

  return transformSubscription(subscription);
}


/**
 * Gets a subscription by ID
 */
export async function getSubscription(subscriptionId: string): Promise<SubscriptionWithProducts> {
  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { products: true },
  });

  if (!subscription) {
    throw ApiError.notFound('SUB_005', 'Subscription not found');
  }

  return transformSubscription(subscription);
}

/**
 * Gets all subscriptions for a customer
 */
export async function getCustomerSubscriptions(
  customerId: string
): Promise<SubscriptionWithProducts[]> {
  const subscriptions = await prisma.subscription.findMany({
    where: { customerId },
    include: { products: true },
    orderBy: { createdAt: 'desc' },
  });

  return subscriptions.map(transformSubscription);
}

/**
 * Updates a subscription (applies from next delivery cycle)
 * Requirements: 2.4
 */
export async function updateSubscription(
  subscriptionId: string,
  customerId: string,
  data: Partial<SubscriptionInput>
): Promise<SubscriptionWithProducts> {
  const subscription = await prisma.subscription.findFirst({
    where: { id: subscriptionId, customerId },
    include: { products: true },
  });

  if (!subscription) {
    throw ApiError.notFound('SUB_005', 'Subscription not found');
  }

  if (subscription.status === 'CANCELLED') {
    throw ApiError.badRequest('SUB_008', 'Cannot modify a cancelled subscription');
  }

  // Validate delivery slot if provided
  if (data.deliverySlotId) {
    const deliverySlot = await prisma.deliverySlot.findUnique({
      where: { id: data.deliverySlotId },
    });

    if (!deliverySlot || !deliverySlot.isActive) {
      throw ApiError.badRequest('SUB_003', 'Selected delivery slot is not available');
    }
  }

  // Validate products if provided
  if (data.products) {
    if (data.products.length === 0) {
      throw ApiError.badRequest('SUB_001', 'Please select at least one product');
    }

    for (const product of data.products) {
      if (product.quantity < 1 || product.quantity > 10) {
        throw ApiError.badRequest('SUB_002', 'Quantity must be between 1 and 10');
      }
    }

    const productIds = data.products.map(p => p.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, isAvailable: true },
    });

    if (products.length !== productIds.length) {
      throw ApiError.badRequest('SUB_007', 'One or more selected products are not available');
    }
  }

  // Update subscription in a transaction
  const updated = await prisma.$transaction(async (tx) => {
    // Update subscription fields
    const sub = await tx.subscription.update({
      where: { id: subscriptionId },
      data: {
        ...(data.frequency && { frequency: data.frequency.toUpperCase() }),
        ...(data.deliverySlotId && { deliverySlotId: data.deliverySlotId }),
      },
    });

    // Update products if provided
    if (data.products) {
      // Get current product prices
      const productIds = data.products.map(p => p.productId);
      const products = await tx.product.findMany({
        where: { id: { in: productIds } },
      });
      const productMap = new Map(products.map(p => [p.id, p]));

      // Delete existing products
      await tx.subscriptionProduct.deleteMany({
        where: { subscriptionId },
      });

      // Create new products
      await tx.subscriptionProduct.createMany({
        data: data.products.map(p => ({
          subscriptionId,
          productId: p.productId,
          quantity: p.quantity,
          priceAtTime: productMap.get(p.productId)!.price,
        })),
      });
    }

    return tx.subscription.findUnique({
      where: { id: subscriptionId },
      include: { products: true },
    });
  });

  return transformSubscription(updated);
}


/**
 * Pauses a subscription for a specified period
 * Requirements: 2.5
 */
export async function pauseSubscription(
  subscriptionId: string,
  customerId: string,
  pauseData: PauseInput
): Promise<SubscriptionWithProducts> {
  const subscription = await prisma.subscription.findFirst({
    where: { id: subscriptionId, customerId },
    include: { products: true },
  });

  if (!subscription) {
    throw ApiError.notFound('SUB_005', 'Subscription not found');
  }

  if (subscription.status === 'CANCELLED') {
    throw ApiError.badRequest('SUB_008', 'Cannot pause a cancelled subscription');
  }

  if (subscription.status === 'PAUSED') {
    throw ApiError.badRequest('SUB_009', 'Subscription is already paused');
  }

  // Validate pause dates
  const startDate = new Date(pauseData.startDate);
  const endDate = new Date(pauseData.endDate);
  
  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(0, 0, 0, 0);

  if (endDate <= startDate) {
    throw ApiError.badRequest('SUB_004', 'Pause end date must be after start date');
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (startDate < today) {
    throw ApiError.badRequest('SUB_010', 'Pause start date cannot be in the past');
  }

  const updated = await prisma.subscription.update({
    where: { id: subscriptionId },
    data: {
      status: 'PAUSED',
      pauseStart: startDate,
      pauseEnd: endDate,
    },
    include: { products: true },
  });

  return transformSubscription(updated);
}

/**
 * Resumes a paused subscription
 * Requirements: 2.5
 */
export async function resumeSubscription(
  subscriptionId: string,
  customerId: string
): Promise<SubscriptionWithProducts> {
  const subscription = await prisma.subscription.findFirst({
    where: { id: subscriptionId, customerId },
    include: { products: true },
  });

  if (!subscription) {
    throw ApiError.notFound('SUB_005', 'Subscription not found');
  }

  if (subscription.status !== 'PAUSED') {
    throw ApiError.badRequest('SUB_011', 'Subscription is not paused');
  }

  const updated = await prisma.subscription.update({
    where: { id: subscriptionId },
    data: {
      status: 'ACTIVE',
      pauseStart: null,
      pauseEnd: null,
    },
    include: { products: true },
  });

  return transformSubscription(updated);
}

/**
 * Cancels a subscription
 */
export async function cancelSubscription(
  subscriptionId: string,
  customerId: string
): Promise<void> {
  const subscription = await prisma.subscription.findFirst({
    where: { id: subscriptionId, customerId },
  });

  if (!subscription) {
    throw ApiError.notFound('SUB_005', 'Subscription not found');
  }

  if (subscription.status === 'CANCELLED') {
    throw ApiError.badRequest('SUB_012', 'Subscription is already cancelled');
  }

  await prisma.subscription.update({
    where: { id: subscriptionId },
    data: { status: 'CANCELLED' },
  });
}

/**
 * Gets all available delivery slots
 */
export async function getDeliverySlots(): Promise<Array<{
  id: string;
  startTime: string;
  endTime: string;
  label: string;
}>> {
  const slots = await prisma.deliverySlot.findMany({
    where: { isActive: true },
    orderBy: { startTime: 'asc' },
  });

  return slots.map(slot => ({
    id: slot.id,
    startTime: slot.startTime,
    endTime: slot.endTime,
    label: slot.label,
  }));
}
