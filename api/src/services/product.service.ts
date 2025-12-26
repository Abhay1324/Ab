import { prisma } from '../lib/prisma.js';
import { ApiError } from '../middleware/errorHandler.js';
import type { Product, ProductInput } from '@milk-subscription/shared';
import { sendProductUnavailableNotification, sendBulkNotification } from './notification.service.js';

/**
 * Transforms a Prisma product to the shared Product type
 */
function transformProduct(product: any): Product {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    price: product.price,
    unit: product.unit,
    isAvailable: product.isAvailable,
    createdAt: product.createdAt,
  };
}

/**
 * Gets all available products for subscription
 * Requirements: 9.1
 */
export async function getAvailableProducts(): Promise<Product[]> {
  const products = await prisma.product.findMany({
    where: { isAvailable: true },
    orderBy: { name: 'asc' },
  });

  return products.map(transformProduct);
}

/**
 * Gets all products (including unavailable) - for admin
 * Requirements: 9.1
 */
export async function getAllProducts(): Promise<Product[]> {
  const products = await prisma.product.findMany({
    orderBy: { name: 'asc' },
  });

  return products.map(transformProduct);
}

/**
 * Gets a product by ID
 */
export async function getProductById(productId: string): Promise<Product> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
  });

  if (!product) {
    throw ApiError.notFound('PROD_001', 'Product not found');
  }

  return transformProduct(product);
}


/**
 * Creates a new product - admin only
 * Requirements: 9.1
 */
export async function createProduct(data: ProductInput): Promise<Product> {
  const product = await prisma.product.create({
    data: {
      name: data.name,
      description: data.description,
      price: data.price,
      unit: data.unit,
      isAvailable: data.isAvailable ?? true,
    },
  });

  return transformProduct(product);
}

/**
 * Updates a product - admin only
 * Price changes only apply to new subscriptions (existing subscriptions keep their priceAtTime)
 * Requirements: 9.2
 */
export async function updateProduct(
  productId: string,
  data: Partial<ProductInput>
): Promise<Product> {
  const existing = await prisma.product.findUnique({
    where: { id: productId },
  });

  if (!existing) {
    throw ApiError.notFound('PROD_001', 'Product not found');
  }

  const updated = await prisma.product.update({
    where: { id: productId },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.price !== undefined && { price: data.price }),
      ...(data.unit !== undefined && { unit: data.unit }),
      ...(data.isAvailable !== undefined && { isAvailable: data.isAvailable }),
    },
  });

  return transformProduct(updated);
}

/**
 * Sets product availability
 * When set to unavailable, affected customers should be notified
 * Requirements: 9.3
 */
export async function setProductAvailability(
  productId: string,
  isAvailable: boolean
): Promise<{ product: Product; affectedCustomerIds: string[] }> {
  const existing = await prisma.product.findUnique({
    where: { id: productId },
  });

  if (!existing) {
    throw ApiError.notFound('PROD_001', 'Product not found');
  }

  // Find affected customers if making unavailable
  let affectedCustomerIds: string[] = [];
  if (!isAvailable && existing.isAvailable) {
    const affectedSubscriptions = await prisma.subscriptionProduct.findMany({
      where: {
        productId,
        subscription: {
          status: 'ACTIVE',
        },
      },
      include: {
        subscription: {
          select: { customerId: true },
        },
      },
    });

    affectedCustomerIds = [...new Set(
      affectedSubscriptions.map(sp => sp.subscription.customerId)
    )];
  }

  const updated = await prisma.product.update({
    where: { id: productId },
    data: { isAvailable },
  });

  // Send notifications to affected customers - Requirements: 9.3
  if (affectedCustomerIds.length > 0) {
    const productName = existing.name;
    // Fire and forget - don't block the availability update
    sendBulkNotification(
      affectedCustomerIds,
      (customerId) => sendProductUnavailableNotification(customerId, productName)
    ).then((result) => {
      console.log(`[PRODUCT] Unavailability notifications sent: ${result.success} success, ${result.failed} failed`);
    }).catch((err) => {
      console.error('[PRODUCT] Failed to send unavailability notifications:', err);
    });
  }

  return {
    product: transformProduct(updated),
    affectedCustomerIds,
  };
}

/**
 * Deletes a product (soft delete by setting unavailable)
 * Products with active subscriptions cannot be hard deleted
 */
export async function deleteProduct(productId: string): Promise<void> {
  const existing = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      subscriptionProducts: {
        where: {
          subscription: {
            status: 'ACTIVE',
          },
        },
      },
    },
  });

  if (!existing) {
    throw ApiError.notFound('PROD_001', 'Product not found');
  }

  if (existing.subscriptionProducts.length > 0) {
    throw ApiError.conflict(
      'PROD_002',
      'Cannot delete product with active subscriptions. Set as unavailable instead.'
    );
  }

  await prisma.product.delete({
    where: { id: productId },
  });
}
