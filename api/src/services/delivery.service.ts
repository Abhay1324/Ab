import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errorHandler.js';
import type {
  Delivery,
  DeliveryStatus,
  DeliveryProof,
  FailureReason,
  DeliveryRoute,
  DeliveryFilters,
} from '@milk-subscription/shared';
import {
  sendDeliveryCompletedNotification,
  sendDeliveryFailedNotification,
} from './notification.service.js';

/**
 * Delivery Service
 * Handles delivery generation, route optimization, and status updates
 * Requirements: 5.1, 5.2, 5.3, 5.4
 */

/**
 * Transforms a Prisma delivery to the shared Delivery type
 */
function transformDelivery(delivery: any): Delivery {
  return {
    id: delivery.id,
    subscriptionId: delivery.subscriptionId,
    customerId: delivery.subscription?.customerId ?? '',
    customerName: delivery.subscription?.customer?.name ?? '',
    deliveryBoyId: delivery.deliveryBoyId ?? undefined,
    address: delivery.subscription?.address
      ? {
          line1: delivery.subscription.address.line1,
          line2: delivery.subscription.address.line2 ?? undefined,
          landmark: delivery.subscription.address.landmark ?? undefined,
          city: delivery.subscription.address.city,
          state: delivery.subscription.address.state,
          pincode: delivery.subscription.address.pincode,
          coordinates: delivery.subscription.address.latitude && delivery.subscription.address.longitude
            ? { lat: delivery.subscription.address.latitude, lng: delivery.subscription.address.longitude }
            : undefined,
        }
      : { line1: '', city: '', state: '', pincode: '' },
    products: delivery.subscription?.products?.map((p: any) => ({
      productId: p.productId,
      productName: p.product?.name ?? '',
      quantity: p.quantity,
      unit: p.product?.unit ?? '',
    })) ?? [],
    status: delivery.status.toLowerCase() as DeliveryStatus,
    scheduledSlot: delivery.subscription?.deliverySlot
      ? {
          id: delivery.subscription.deliverySlot.id,
          startTime: delivery.subscription.deliverySlot.startTime,
          endTime: delivery.subscription.deliverySlot.endTime,
          label: delivery.subscription.deliverySlot.label,
          isActive: delivery.subscription.deliverySlot.isActive,
        }
      : { id: '', startTime: '', endTime: '', label: '', isActive: false },
    deliveryDate: delivery.deliveryDate,
    completedAt: delivery.completedAt ?? undefined,
    proof: delivery.proofUrl && delivery.proofType
      ? {
          type: delivery.proofType as 'photo' | 'signature',
          url: delivery.proofUrl,
          capturedAt: delivery.completedAt ?? new Date(),
        }
      : undefined,
    failureReason: delivery.failureReason
      ? {
          code: delivery.failureReason,
          description: getFailureDescription(delivery.failureReason),
          notes: delivery.failureNotes ?? undefined,
        }
      : undefined,
  };
}


/**
 * Standard failure reason codes and descriptions
 */
const FAILURE_REASONS: Record<string, string> = {
  CUSTOMER_UNAVAILABLE: 'Customer was not available',
  WRONG_ADDRESS: 'Address was incorrect or not found',
  CUSTOMER_REFUSED: 'Customer refused delivery',
  ACCESS_DENIED: 'Could not access the location',
  WEATHER_CONDITIONS: 'Delivery not possible due to weather',
  VEHICLE_BREAKDOWN: 'Delivery vehicle breakdown',
  OTHER: 'Other reason',
};

function getFailureDescription(code: string): string {
  return FAILURE_REASONS[code] ?? 'Unknown reason';
}

/**
 * Gets all valid failure reason codes
 */
export function getFailureReasonCodes(): Array<{ code: string; description: string }> {
  return Object.entries(FAILURE_REASONS).map(([code, description]) => ({
    code,
    description,
  }));
}

/**
 * Generates deliveries from active subscriptions for a given date
 * Requirements: 5.1
 */
export async function generateDeliveriesForDate(date: Date): Promise<number> {
  const targetDate = new Date(date);
  targetDate.setHours(0, 0, 0, 0);

  // Get all active subscriptions
  const subscriptions = await prisma.subscription.findMany({
    where: {
      status: 'ACTIVE',
      startDate: { lte: targetDate },
    },
    include: {
      address: true,
      products: true,
    },
  });

  let createdCount = 0;

  for (const subscription of subscriptions) {
    // Check if delivery should happen on this date based on frequency
    const shouldDeliver = shouldDeliverOnDate(
      subscription.startDate,
      targetDate,
      subscription.frequency
    );

    if (!shouldDeliver) continue;

    // Check if delivery already exists for this date
    const existingDelivery = await prisma.delivery.findFirst({
      where: {
        subscriptionId: subscription.id,
        deliveryDate: targetDate,
      },
    });

    if (existingDelivery) continue;

    // Find delivery boy for the address pincode
    const deliveryBoy = await prisma.deliveryBoy.findFirst({
      where: {
        isActive: true,
        area: {
          pincodes: { contains: subscription.address.pincode },
        },
      },
    });

    // Create delivery
    await prisma.delivery.create({
      data: {
        subscriptionId: subscription.id,
        deliveryBoyId: deliveryBoy?.id ?? null,
        deliveryDate: targetDate,
        status: 'PENDING',
      },
    });

    createdCount++;
  }

  return createdCount;
}


/**
 * Determines if a delivery should happen on a given date based on frequency
 */
export function shouldDeliverOnDate(
  startDate: Date,
  targetDate: Date,
  frequency: string
): boolean {
  const start = new Date(startDate);
  start.setHours(0, 0, 0, 0);
  
  const target = new Date(targetDate);
  target.setHours(0, 0, 0, 0);

  if (target < start) return false;

  const daysDiff = Math.floor((target.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));

  switch (frequency.toUpperCase()) {
    case 'DAILY':
      return true;
    case 'ALTERNATE':
      return daysDiff % 2 === 0;
    case 'WEEKLY':
      return daysDiff % 7 === 0;
    default:
      return false;
  }
}

/**
 * Gets today's deliveries for a delivery boy
 * Requirements: 5.1
 */
export async function getTodayDeliveries(deliveryBoyId: string): Promise<Delivery[]> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const deliveries = await prisma.delivery.findMany({
    where: {
      deliveryBoyId,
      deliveryDate: {
        gte: today,
        lt: tomorrow,
      },
    },
    include: {
      subscription: {
        include: {
          customer: true,
          address: true,
          deliverySlot: true,
          products: {
            include: {
              product: true,
            },
          },
        },
      },
    },
    orderBy: {
      createdAt: 'asc',
    },
  });

  return deliveries.map(transformDelivery);
}

/**
 * Gets a delivery by ID
 */
export async function getDeliveryById(deliveryId: string): Promise<Delivery> {
  const delivery = await prisma.delivery.findUnique({
    where: { id: deliveryId },
    include: {
      subscription: {
        include: {
          customer: true,
          address: true,
          deliverySlot: true,
          products: {
            include: {
              product: true,
            },
          },
        },
      },
    },
  });

  if (!delivery) {
    throw ApiError.notFound('DEL_001', 'Delivery not found');
  }

  return transformDelivery(delivery);
}


/**
 * Calculates distance between two coordinates using Haversine formula
 */
function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculates total distance for a route
 */
export function calculateTotalDistance(deliveries: Delivery[]): number {
  if (deliveries.length < 2) return 0;

  let totalDistance = 0;
  for (let i = 1; i < deliveries.length; i++) {
    const prev = deliveries[i - 1]!;
    const curr = deliveries[i]!;

    if (prev.address.coordinates && curr.address.coordinates) {
      totalDistance += calculateDistance(
        prev.address.coordinates.lat,
        prev.address.coordinates.lng,
        curr.address.coordinates.lat,
        curr.address.coordinates.lng
      );
    } else {
      // Default distance when coordinates not available
      totalDistance += 1;
    }
  }

  return totalDistance;
}

/**
 * Optimizes delivery route using nearest neighbor algorithm
 * Requirements: 5.1 - WHEN a delivery boy views delivery list, THE Delivery_App SHALL show optimized route order
 */
export function optimizeRoute(deliveries: Delivery[]): Delivery[] {
  if (deliveries.length <= 1) return deliveries;

  // Filter deliveries with valid coordinates
  const withCoords = deliveries.filter(
    (d) => d.address.coordinates?.lat && d.address.coordinates?.lng
  );
  const withoutCoords = deliveries.filter(
    (d) => !d.address.coordinates?.lat || !d.address.coordinates?.lng
  );

  if (withCoords.length <= 1) {
    return [...withCoords, ...withoutCoords];
  }

  // Nearest neighbor algorithm
  const optimized: Delivery[] = [];
  const remaining = [...withCoords];

  // Start with first delivery
  optimized.push(remaining.shift()!);

  while (remaining.length > 0) {
    const last = optimized[optimized.length - 1]!;
    let nearestIdx = 0;
    let nearestDist = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const dist = calculateDistance(
        last.address.coordinates!.lat,
        last.address.coordinates!.lng,
        remaining[i]!.address.coordinates!.lat,
        remaining[i]!.address.coordinates!.lng
      );

      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = i;
      }
    }

    optimized.push(remaining.splice(nearestIdx, 1)[0]!);
  }

  // Add deliveries without coordinates at the end
  return [...optimized, ...withoutCoords];
}


/**
 * Gets optimized route for a delivery boy
 * Requirements: 5.1
 */
export async function getOptimizedRoute(deliveryBoyId: string): Promise<DeliveryRoute> {
  const deliveries = await getTodayDeliveries(deliveryBoyId);
  
  // Filter only pending and in_progress deliveries for route
  const activeDeliveries = deliveries.filter(
    (d) => d.status === 'pending' || d.status === 'in_progress'
  );

  const optimizedDeliveries = optimizeRoute(activeDeliveries);
  const totalDistance = calculateTotalDistance(optimizedDeliveries);

  // Estimate 5 minutes per delivery + travel time (assuming 30 km/h average speed)
  const estimatedTime = optimizedDeliveries.length * 5 + (totalDistance / 30) * 60;

  return {
    deliveries: optimizedDeliveries,
    totalDistance: Math.round(totalDistance * 100) / 100,
    estimatedTime: Math.round(estimatedTime),
  };
}

/**
 * Marks a delivery as completed with proof
 * Requirements: 5.2, 5.4
 */
export async function markDeliveryCompleted(
  deliveryId: string,
  deliveryBoyId: string,
  proof: DeliveryProof
): Promise<Delivery> {
  const delivery = await prisma.delivery.findUnique({
    where: { id: deliveryId },
    include: {
      subscription: {
        include: {
          customer: true,
          address: true,
          deliverySlot: true,
          products: {
            include: {
              product: true,
            },
          },
        },
      },
    },
  });

  if (!delivery) {
    throw ApiError.notFound('DEL_001', 'Delivery not found');
  }

  if (delivery.deliveryBoyId !== deliveryBoyId) {
    throw ApiError.forbidden('DEL_005', 'Not authorized to update this delivery');
  }

  if (delivery.status === 'DELIVERED') {
    throw ApiError.badRequest('DEL_002', 'Delivery already marked as completed');
  }

  if (!proof || !proof.url) {
    throw ApiError.badRequest('DEL_003', 'Please capture delivery proof');
  }

  const updated = await prisma.delivery.update({
    where: { id: deliveryId },
    data: {
      status: 'DELIVERED',
      proofUrl: proof.url,
      proofType: proof.type,
      completedAt: new Date(),
    },
    include: {
      subscription: {
        include: {
          customer: true,
          address: true,
          deliverySlot: true,
          products: {
            include: {
              product: true,
            },
          },
        },
      },
    },
  });

  // Send notification to customer - Requirements: 5.2
  const customerId = updated.subscription?.customerId;
  const products = updated.subscription?.products?.map((p: any) => ({
    name: p.product?.name ?? 'Unknown Product',
    quantity: p.quantity,
  })) ?? [];

  if (customerId) {
    // Fire and forget - don't block delivery completion
    sendDeliveryCompletedNotification(customerId, deliveryId, products).catch((err) => {
      console.error('[DELIVERY] Failed to send completion notification:', err);
    });
  }

  return transformDelivery(updated);
}


/**
 * Marks a delivery as failed with reason
 * Requirements: 5.3
 */
export async function markDeliveryFailed(
  deliveryId: string,
  deliveryBoyId: string,
  reason: FailureReason
): Promise<Delivery> {
  const delivery = await prisma.delivery.findUnique({
    where: { id: deliveryId },
    include: {
      subscription: {
        include: {
          customer: true,
          address: true,
          deliverySlot: true,
          products: {
            include: {
              product: true,
            },
          },
        },
      },
    },
  });

  if (!delivery) {
    throw ApiError.notFound('DEL_001', 'Delivery not found');
  }

  if (delivery.deliveryBoyId !== deliveryBoyId) {
    throw ApiError.forbidden('DEL_005', 'Not authorized to update this delivery');
  }

  if (delivery.status === 'DELIVERED' || delivery.status === 'FAILED') {
    throw ApiError.badRequest('DEL_006', 'Delivery status cannot be changed');
  }

  if (!reason || !reason.code) {
    throw ApiError.badRequest('DEL_004', 'Please select failure reason');
  }

  // Validate failure reason code
  if (!FAILURE_REASONS[reason.code]) {
    throw ApiError.badRequest('DEL_007', 'Invalid failure reason code');
  }

  const updated = await prisma.delivery.update({
    where: { id: deliveryId },
    data: {
      status: 'FAILED',
      failureReason: reason.code,
      failureNotes: reason.notes ?? null,
      completedAt: new Date(),
    },
    include: {
      subscription: {
        include: {
          customer: true,
          address: true,
          deliverySlot: true,
          products: {
            include: {
              product: true,
            },
          },
        },
      },
    },
  });

  // Send notification to customer - Requirements: 5.3
  const customerId = updated.subscription?.customerId;
  const reasonDescription = getFailureDescription(reason.code);

  if (customerId) {
    // Fire and forget - don't block delivery failure marking
    sendDeliveryFailedNotification(customerId, deliveryId, reasonDescription).catch((err) => {
      console.error('[DELIVERY] Failed to send failure notification:', err);
    });
  }

  return transformDelivery(updated);
}

/**
 * Updates delivery status to in_progress
 */
export async function startDelivery(
  deliveryId: string,
  deliveryBoyId: string
): Promise<Delivery> {
  const delivery = await prisma.delivery.findUnique({
    where: { id: deliveryId },
    include: {
      subscription: {
        include: {
          customer: true,
          address: true,
          deliverySlot: true,
          products: {
            include: {
              product: true,
            },
          },
        },
      },
    },
  });

  if (!delivery) {
    throw ApiError.notFound('DEL_001', 'Delivery not found');
  }

  if (delivery.deliveryBoyId !== deliveryBoyId) {
    throw ApiError.forbidden('DEL_005', 'Not authorized to update this delivery');
  }

  if (delivery.status !== 'PENDING') {
    throw ApiError.badRequest('DEL_008', 'Delivery is not in pending status');
  }

  const updated = await prisma.delivery.update({
    where: { id: deliveryId },
    data: { status: 'IN_PROGRESS' },
    include: {
      subscription: {
        include: {
          customer: true,
          address: true,
          deliverySlot: true,
          products: {
            include: {
              product: true,
            },
          },
        },
      },
    },
  });

  return transformDelivery(updated);
}


/**
 * Gets delivery history for a delivery boy with filters
 */
export async function getDeliveryHistory(
  deliveryBoyId: string,
  filters?: DeliveryFilters
): Promise<Delivery[]> {
  const where: any = { deliveryBoyId };

  if (filters?.status) {
    where.status = filters.status.toUpperCase();
  }

  if (filters?.startDate || filters?.endDate) {
    where.deliveryDate = {};
    if (filters.startDate) {
      where.deliveryDate.gte = new Date(filters.startDate);
    }
    if (filters.endDate) {
      where.deliveryDate.lte = new Date(filters.endDate);
    }
  }

  const deliveries = await prisma.delivery.findMany({
    where,
    include: {
      subscription: {
        include: {
          customer: true,
          address: true,
          deliverySlot: true,
          products: {
            include: {
              product: true,
            },
          },
        },
      },
    },
    orderBy: { deliveryDate: 'desc' },
    take: filters?.limit ?? 50,
    skip: filters?.offset ?? 0,
  });

  return deliveries.map(transformDelivery);
}

/**
 * Gets deliveries for a specific date
 */
export async function getDeliveriesForDate(
  deliveryBoyId: string,
  date: Date
): Promise<Delivery[]> {
  const targetDate = new Date(date);
  targetDate.setHours(0, 0, 0, 0);
  const nextDay = new Date(targetDate);
  nextDay.setDate(nextDay.getDate() + 1);

  const deliveries = await prisma.delivery.findMany({
    where: {
      deliveryBoyId,
      deliveryDate: {
        gte: targetDate,
        lt: nextDay,
      },
    },
    include: {
      subscription: {
        include: {
          customer: true,
          address: true,
          deliverySlot: true,
          products: {
            include: {
              product: true,
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return deliveries.map(transformDelivery);
}

/**
 * Validates that a completed delivery has all required fields
 * Used for Property 12: Delivery Completion Integrity
 */
export function validateDeliveryCompletion(delivery: Delivery): {
  isValid: boolean;
  hasStatus: boolean;
  hasProof: boolean;
} {
  const hasStatus = delivery.status === 'delivered';
  const hasProof = !!delivery.proof && !!delivery.proof.url;

  return {
    isValid: hasStatus && hasProof,
    hasStatus,
    hasProof,
  };
}

/**
 * Validates that a failed delivery has a reason
 * Used for Property 13: Failed Delivery Reason Required
 */
export function validateFailedDeliveryReason(delivery: Delivery): boolean {
  if (delivery.status !== 'failed') return true;
  return !!delivery.failureReason && !!delivery.failureReason.code;
}
