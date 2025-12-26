import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errorHandler.js';
import type { DeliveryBoy, DeliveryBoyInput, Area } from '@milk-subscription/shared';
import bcrypt from 'bcryptjs';

/**
 * Transforms a Prisma delivery boy to the shared DeliveryBoy type
 */
function transformDeliveryBoy(deliveryBoy: any): DeliveryBoy {
  return {
    id: deliveryBoy.id,
    phone: deliveryBoy.phone,
    name: deliveryBoy.name,
    areaId: deliveryBoy.areaId,
    isActive: deliveryBoy.isActive,
    createdAt: deliveryBoy.createdAt,
  };
}

/**
 * Transforms a Prisma area to the shared Area type
 */
function transformArea(area: any): Area {
  return {
    id: area.id,
    name: area.name,
    pincodes: area.pincodes ? area.pincodes.split(',').map((p: string) => p.trim()) : [],
  };
}

/**
 * Gets all areas
 */
export async function getAllAreas(): Promise<Area[]> {
  const areas = await prisma.area.findMany({
    orderBy: { name: 'asc' },
  });

  return areas.map(transformArea);
}

/**
 * Gets an area by ID
 */
export async function getAreaById(areaId: string): Promise<Area> {
  const area = await prisma.area.findUnique({
    where: { id: areaId },
  });

  if (!area) {
    throw ApiError.notFound('AREA_001', 'Area not found');
  }

  return transformArea(area);
}


/**
 * Creates a new area
 */
export async function createArea(data: { name: string; pincodes: string[] }): Promise<Area> {
  const area = await prisma.area.create({
    data: {
      name: data.name,
      pincodes: data.pincodes.join(','),
    },
  });

  return transformArea(area);
}

/**
 * Gets all delivery boys
 * Requirements: 8.1
 */
export async function getAllDeliveryBoys(): Promise<DeliveryBoy[]> {
  const deliveryBoys = await prisma.deliveryBoy.findMany({
    orderBy: { name: 'asc' },
  });

  return deliveryBoys.map(transformDeliveryBoy);
}

/**
 * Gets active delivery boys
 */
export async function getActiveDeliveryBoys(): Promise<DeliveryBoy[]> {
  const deliveryBoys = await prisma.deliveryBoy.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
  });

  return deliveryBoys.map(transformDeliveryBoy);
}

/**
 * Gets a delivery boy by ID
 */
export async function getDeliveryBoyById(deliveryBoyId: string): Promise<DeliveryBoy> {
  const deliveryBoy = await prisma.deliveryBoy.findUnique({
    where: { id: deliveryBoyId },
  });

  if (!deliveryBoy) {
    throw ApiError.notFound('DBOY_001', 'Delivery boy not found');
  }

  return transformDeliveryBoy(deliveryBoy);
}

/**
 * Gets a delivery boy by phone
 */
export async function getDeliveryBoyByPhone(phone: string): Promise<DeliveryBoy | null> {
  const deliveryBoy = await prisma.deliveryBoy.findUnique({
    where: { phone },
  });

  return deliveryBoy ? transformDeliveryBoy(deliveryBoy) : null;
}


/**
 * Creates a new delivery boy with assigned area
 * Requirements: 8.1 - WHEN an admin adds delivery boy, THE Admin_Panel SHALL create account with assigned area
 */
export async function createDeliveryBoy(data: DeliveryBoyInput): Promise<DeliveryBoy> {
  // Validate area exists
  const area = await prisma.area.findUnique({
    where: { id: data.areaId },
  });

  if (!area) {
    throw ApiError.badRequest('DBOY_002', 'Invalid area ID');
  }

  // Check if phone already exists
  const existing = await prisma.deliveryBoy.findUnique({
    where: { phone: data.phone },
  });

  if (existing) {
    throw ApiError.conflict('DBOY_003', 'Phone number already registered');
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(data.password, 10);

  const deliveryBoy = await prisma.deliveryBoy.create({
    data: {
      phone: data.phone,
      name: data.name,
      password: hashedPassword,
      areaId: data.areaId,
      isActive: true,
    },
  });

  return transformDeliveryBoy(deliveryBoy);
}

/**
 * Updates a delivery boy
 */
export async function updateDeliveryBoy(
  deliveryBoyId: string,
  data: Partial<Omit<DeliveryBoyInput, 'password'> & { password?: string; isActive?: boolean }>
): Promise<DeliveryBoy> {
  const existing = await prisma.deliveryBoy.findUnique({
    where: { id: deliveryBoyId },
  });

  if (!existing) {
    throw ApiError.notFound('DBOY_001', 'Delivery boy not found');
  }

  // Validate area if being updated
  if (data.areaId) {
    const area = await prisma.area.findUnique({
      where: { id: data.areaId },
    });

    if (!area) {
      throw ApiError.badRequest('DBOY_002', 'Invalid area ID');
    }
  }

  // Check phone uniqueness if being updated
  if (data.phone && data.phone !== existing.phone) {
    const phoneExists = await prisma.deliveryBoy.findUnique({
      where: { phone: data.phone },
    });

    if (phoneExists) {
      throw ApiError.conflict('DBOY_003', 'Phone number already registered');
    }
  }

  const updateData: any = {};
  if (data.name !== undefined) updateData.name = data.name;
  if (data.phone !== undefined) updateData.phone = data.phone;
  if (data.areaId !== undefined) updateData.areaId = data.areaId;
  if (data.isActive !== undefined) updateData.isActive = data.isActive;
  if (data.password) updateData.password = await bcrypt.hash(data.password, 10);

  const updated = await prisma.deliveryBoy.update({
    where: { id: deliveryBoyId },
    data: updateData,
  });

  return transformDeliveryBoy(updated);
}


/**
 * Reassigns a delivery boy to a new area and cascades delivery reassignments
 * Requirements: 8.3 - WHEN an admin reassigns area, THE Admin_Panel SHALL update delivery assignments automatically
 */
export async function reassignDeliveryBoyArea(
  deliveryBoyId: string,
  newAreaId: string
): Promise<{ deliveryBoy: DeliveryBoy; reassignedDeliveries: number }> {
  const existing = await prisma.deliveryBoy.findUnique({
    where: { id: deliveryBoyId },
    include: { area: true },
  });

  if (!existing) {
    throw ApiError.notFound('DBOY_001', 'Delivery boy not found');
  }

  // Validate new area exists
  const newArea = await prisma.area.findUnique({
    where: { id: newAreaId },
  });

  if (!newArea) {
    throw ApiError.badRequest('DBOY_002', 'Invalid area ID');
  }

  // If same area, no changes needed
  if (existing.areaId === newAreaId) {
    return {
      deliveryBoy: transformDeliveryBoy(existing),
      reassignedDeliveries: 0,
    };
  }

  // Get pending deliveries for this delivery boy
  const pendingDeliveries = await prisma.delivery.findMany({
    where: {
      deliveryBoyId,
      status: 'PENDING',
    },
    include: {
      subscription: {
        include: {
          address: true,
        },
      },
    },
  });

  // Get new area pincodes
  const newAreaPincodes = newArea.pincodes.split(',').map(p => p.trim());

  // Find deliveries that need reassignment (addresses not in new area)
  const deliveriesToReassign = pendingDeliveries.filter(
    d => !newAreaPincodes.includes(d.subscription.address.pincode)
  );

  // Reassign deliveries to other delivery boys covering those areas
  let reassignedCount = 0;
  for (const delivery of deliveriesToReassign) {
    const addressPincode = delivery.subscription.address.pincode;
    
    // Find a delivery boy covering this pincode
    const coveringDeliveryBoy = await prisma.deliveryBoy.findFirst({
      where: {
        id: { not: deliveryBoyId },
        isActive: true,
        area: {
          pincodes: { contains: addressPincode },
        },
      },
    });

    if (coveringDeliveryBoy) {
      await prisma.delivery.update({
        where: { id: delivery.id },
        data: { deliveryBoyId: coveringDeliveryBoy.id },
      });
      reassignedCount++;
    } else {
      // No delivery boy found, unassign the delivery
      await prisma.delivery.update({
        where: { id: delivery.id },
        data: { deliveryBoyId: null },
      });
      reassignedCount++;
    }
  }

  // Update delivery boy's area
  const updated = await prisma.deliveryBoy.update({
    where: { id: deliveryBoyId },
    data: { areaId: newAreaId },
  });

  return {
    deliveryBoy: transformDeliveryBoy(updated),
    reassignedDeliveries: reassignedCount,
  };
}


/**
 * Deactivates a delivery boy
 */
export async function deactivateDeliveryBoy(deliveryBoyId: string): Promise<DeliveryBoy> {
  const existing = await prisma.deliveryBoy.findUnique({
    where: { id: deliveryBoyId },
  });

  if (!existing) {
    throw ApiError.notFound('DBOY_001', 'Delivery boy not found');
  }

  // Unassign all pending deliveries
  await prisma.delivery.updateMany({
    where: {
      deliveryBoyId,
      status: 'PENDING',
    },
    data: { deliveryBoyId: null },
  });

  const updated = await prisma.deliveryBoy.update({
    where: { id: deliveryBoyId },
    data: { isActive: false },
  });

  return transformDeliveryBoy(updated);
}

/**
 * Gets delivery boys by area
 */
export async function getDeliveryBoysByArea(areaId: string): Promise<DeliveryBoy[]> {
  const deliveryBoys = await prisma.deliveryBoy.findMany({
    where: { areaId, isActive: true },
    orderBy: { name: 'asc' },
  });

  return deliveryBoys.map(transformDeliveryBoy);
}

/**
 * Finds a delivery boy covering a specific pincode
 */
export async function findDeliveryBoyForPincode(pincode: string): Promise<DeliveryBoy | null> {
  const deliveryBoy = await prisma.deliveryBoy.findFirst({
    where: {
      isActive: true,
      area: {
        pincodes: { contains: pincode },
      },
    },
  });

  return deliveryBoy ? transformDeliveryBoy(deliveryBoy) : null;
}

/**
 * Validates that a delivery boy has a valid area assigned
 * Used for Property 17: Delivery Boy Area Assignment
 */
export async function validateDeliveryBoyAreaAssignment(deliveryBoyId: string): Promise<boolean> {
  const deliveryBoy = await prisma.deliveryBoy.findUnique({
    where: { id: deliveryBoyId },
    include: { area: true },
  });

  if (!deliveryBoy) {
    return false;
  }

  // Must have exactly one area assigned and area must be valid
  return deliveryBoy.areaId !== null && deliveryBoy.area !== null;
}


/**
 * Authenticates a delivery boy with credentials
 * Requirements: 4.1 - WHEN a delivery boy enters assigned credentials, THE Delivery_App SHALL authenticate and show dashboard
 */
export async function authenticateDeliveryBoy(
  phone: string,
  password: string
): Promise<{ deliveryBoy: DeliveryBoy; isValid: boolean }> {
  const deliveryBoy = await prisma.deliveryBoy.findUnique({
    where: { phone },
  });

  if (!deliveryBoy) {
    return { deliveryBoy: null as any, isValid: false };
  }

  if (!deliveryBoy.isActive) {
    throw ApiError.unauthorized('DBOY_004', 'Account is deactivated');
  }

  const isValid = await bcrypt.compare(password, deliveryBoy.password);

  return {
    deliveryBoy: transformDeliveryBoy(deliveryBoy),
    isValid,
  };
}

/**
 * Gets today's deliveries for a delivery boy
 * Requirements: 4.2 - WHEN a delivery boy logs in, THE Delivery_App SHALL display today's assigned deliveries
 */
export async function getTodayDeliveries(deliveryBoyId: string): Promise<any[]> {
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

  return deliveries.map((d) => ({
    id: d.id,
    subscriptionId: d.subscriptionId,
    customerId: d.subscription.customerId,
    customerName: d.subscription.customer.name,
    customerPhone: d.subscription.customer.phone,
    address: {
      line1: d.subscription.address.line1,
      line2: d.subscription.address.line2,
      landmark: d.subscription.address.landmark,
      city: d.subscription.address.city,
      state: d.subscription.address.state,
      pincode: d.subscription.address.pincode,
    },
    products: d.subscription.products.map((p) => ({
      productId: p.productId,
      productName: p.product.name,
      quantity: p.quantity,
      unit: p.product.unit,
    })),
    status: d.status.toLowerCase(),
    scheduledSlot: {
      id: d.subscription.deliverySlot.id,
      startTime: d.subscription.deliverySlot.startTime,
      endTime: d.subscription.deliverySlot.endTime,
      label: d.subscription.deliverySlot.label,
    },
    deliveryDate: d.deliveryDate,
    completedAt: d.completedAt,
  }));
}

/**
 * Verifies delivery boy credentials and returns user profile for token generation
 */
export async function verifyDeliveryBoyCredentials(
  phone: string,
  password: string
): Promise<{ id: string; phone: string; name: string } | null> {
  const deliveryBoy = await prisma.deliveryBoy.findUnique({
    where: { phone },
  });

  if (!deliveryBoy || !deliveryBoy.isActive) {
    return null;
  }

  const isValid = await bcrypt.compare(password, deliveryBoy.password);
  if (!isValid) {
    return null;
  }

  return {
    id: deliveryBoy.id,
    phone: deliveryBoy.phone,
    name: deliveryBoy.name,
  };
}
