import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errorHandler.js';
import type { Customer, Address } from '@milk-subscription/shared';

export interface CustomerProfileInput {
  name: string;
  email?: string;
}

export interface AddressInput {
  line1: string;
  line2?: string;
  landmark?: string;
  city: string;
  state: string;
  pincode: string;
  latitude?: number;
  longitude?: number;
  isDefault?: boolean;
}

/**
 * Transforms a Prisma customer to the shared Customer type
 */
function transformCustomer(customer: any): Customer {
  return {
    id: customer.id,
    phone: customer.phone,
    name: customer.name,
    email: customer.email ?? undefined,
    addresses: customer.addresses?.map(transformAddress) ?? [],
    isActive: customer.isActive,
    createdAt: customer.createdAt,
  };
}

/**
 * Transforms a Prisma address to the shared Address type
 */
function transformAddress(address: any): Address {
  return {
    id: address.id,
    line1: address.line1,
    line2: address.line2 ?? undefined,
    landmark: address.landmark ?? undefined,
    city: address.city,
    state: address.state,
    pincode: address.pincode,
    coordinates: address.latitude && address.longitude
      ? { lat: address.latitude, lng: address.longitude }
      : undefined,
    isDefault: address.isDefault,
  };
}


/**
 * Gets a customer profile by ID
 */
export async function getCustomerProfile(customerId: string): Promise<Customer> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: { addresses: true },
  });

  if (!customer) {
    throw ApiError.notFound('CUST_001', 'Customer not found');
  }

  return transformCustomer(customer);
}

/**
 * Creates a customer profile (updates name/email for existing customer)
 */
export async function createCustomerProfile(
  customerId: string,
  data: CustomerProfileInput
): Promise<Customer> {
  // Use upsert-like pattern to avoid race conditions
  try {
    const updated = await prisma.customer.update({
      where: { id: customerId },
      data: {
        name: data.name,
        email: data.email,
      },
      include: { addresses: true },
    });

    return transformCustomer(updated);
  } catch (error: any) {
    // Handle case where customer doesn't exist
    if (error.code === 'P2025') {
      throw ApiError.notFound('CUST_001', 'Customer not found');
    }
    throw error;
  }
}

/**
 * Updates a customer profile
 */
export async function updateCustomerProfile(
  customerId: string,
  data: Partial<CustomerProfileInput>
): Promise<Customer> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
  });

  if (!customer) {
    throw ApiError.notFound('CUST_001', 'Customer not found');
  }

  const updated = await prisma.customer.update({
    where: { id: customerId },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.email !== undefined && { email: data.email }),
    },
    include: { addresses: true },
  });

  return transformCustomer(updated);
}


/**
 * Adds a new address for a customer
 */
export async function addCustomerAddress(
  customerId: string,
  data: AddressInput
): Promise<Address> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
  });

  if (!customer) {
    throw ApiError.notFound('CUST_001', 'Customer not found');
  }

  // If this is the first address or marked as default, handle default logic
  if (data.isDefault) {
    await prisma.address.updateMany({
      where: { customerId },
      data: { isDefault: false },
    });
  }

  // Check if customer has any addresses
  const existingAddresses = await prisma.address.count({
    where: { customerId },
  });

  const address = await prisma.address.create({
    data: {
      customerId,
      line1: data.line1,
      line2: data.line2,
      landmark: data.landmark,
      city: data.city,
      state: data.state,
      pincode: data.pincode,
      latitude: data.latitude,
      longitude: data.longitude,
      isDefault: data.isDefault ?? existingAddresses === 0, // First address is default
    },
  });

  return transformAddress(address);
}

/**
 * Updates an existing address
 */
export async function updateCustomerAddress(
  customerId: string,
  addressId: string,
  data: Partial<AddressInput>
): Promise<Address> {
  const address = await prisma.address.findFirst({
    where: { id: addressId, customerId },
  });

  if (!address) {
    throw ApiError.notFound('CUST_002', 'Address not found');
  }

  // If setting as default, unset other defaults
  if (data.isDefault) {
    await prisma.address.updateMany({
      where: { customerId, id: { not: addressId } },
      data: { isDefault: false },
    });
  }

  const updated = await prisma.address.update({
    where: { id: addressId },
    data: {
      ...(data.line1 !== undefined && { line1: data.line1 }),
      ...(data.line2 !== undefined && { line2: data.line2 }),
      ...(data.landmark !== undefined && { landmark: data.landmark }),
      ...(data.city !== undefined && { city: data.city }),
      ...(data.state !== undefined && { state: data.state }),
      ...(data.pincode !== undefined && { pincode: data.pincode }),
      ...(data.latitude !== undefined && { latitude: data.latitude }),
      ...(data.longitude !== undefined && { longitude: data.longitude }),
      ...(data.isDefault !== undefined && { isDefault: data.isDefault }),
    },
  });

  return transformAddress(updated);
}

/**
 * Deletes an address
 */
export async function deleteCustomerAddress(
  customerId: string,
  addressId: string
): Promise<void> {
  const address = await prisma.address.findFirst({
    where: { id: addressId, customerId },
  });

  if (!address) {
    throw ApiError.notFound('CUST_002', 'Address not found');
  }

  await prisma.address.delete({ where: { id: addressId } });

  // If deleted address was default, make another one default
  if (address.isDefault) {
    const firstAddress = await prisma.address.findFirst({
      where: { customerId },
    });
    if (firstAddress) {
      await prisma.address.update({
        where: { id: firstAddress.id },
        data: { isDefault: true },
      });
    }
  }
}

/**
 * Gets all addresses for a customer
 */
export async function getCustomerAddresses(customerId: string): Promise<Address[]> {
  const addresses = await prisma.address.findMany({
    where: { customerId },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  });

  return addresses.map(transformAddress);
}
