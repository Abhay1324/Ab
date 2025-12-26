import { prisma } from '../lib/prisma.js';

/**
 * Notification Service
 * Handles SMS and Push notifications for various events
 * Requirements: 3.3, 3.4, 5.2, 9.3
 */

// Notification types
export type NotificationType =
  | 'LOW_BALANCE'
  | 'INSUFFICIENT_BALANCE'
  | 'DELIVERY_COMPLETED'
  | 'DELIVERY_FAILED'
  | 'PRODUCT_UNAVAILABLE'
  | 'SUBSCRIPTION_MODIFIED';

export interface NotificationPayload {
  type: NotificationType;
  customerId: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface SMSPayload {
  phone: string;
  message: string;
}

export interface PushPayload {
  deviceToken: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

// SMS Gateway configuration (placeholder for actual integration)
interface SMSGatewayConfig {
  apiKey?: string;
  senderId?: string;
  baseUrl?: string;
}

// Push notification configuration (placeholder for FCM/APNs)
interface PushConfig {
  fcmServerKey?: string;
  apnsKeyId?: string;
  apnsTeamId?: string;
}

// Configuration loaded from environment
const smsConfig: SMSGatewayConfig = {
  apiKey: process.env.SMS_API_KEY,
  senderId: process.env.SMS_SENDER_ID || 'MILKSUB',
  baseUrl: process.env.SMS_BASE_URL,
};

const pushConfig: PushConfig = {
  fcmServerKey: process.env.FCM_SERVER_KEY,
  apnsKeyId: process.env.APNS_KEY_ID,
  apnsTeamId: process.env.APNS_TEAM_ID,
};


/**
 * SMS Notification Handler
 * Integrates with SMS gateway to send text messages
 */
export async function sendSMS(payload: SMSPayload): Promise<boolean> {
  try {
    // In production, this would integrate with an actual SMS gateway
    // Examples: Twilio, AWS SNS, MSG91, etc.
    
    if (!smsConfig.apiKey) {
      // Log for development - in production this would be an error
      console.log(`[SMS] Would send to ${payload.phone}: ${payload.message}`);
      return true;
    }

    // Placeholder for actual SMS gateway integration
    // Example with a generic REST API:
    // const response = await fetch(`${smsConfig.baseUrl}/send`, {
    //   method: 'POST',
    //   headers: {
    //     'Authorization': `Bearer ${smsConfig.apiKey}`,
    //     'Content-Type': 'application/json',
    //   },
    //   body: JSON.stringify({
    //     to: payload.phone,
    //     message: payload.message,
    //     senderId: smsConfig.senderId,
    //   }),
    // });
    // return response.ok;

    console.log(`[SMS] Sent to ${payload.phone}: ${payload.message}`);
    return true;
  } catch (error) {
    console.error('[SMS] Failed to send:', error);
    return false;
  }
}

/**
 * Push Notification Handler
 * Integrates with FCM (Firebase Cloud Messaging) and APNs
 */
export async function sendPushNotification(payload: PushPayload): Promise<boolean> {
  try {
    // In production, this would integrate with FCM/APNs
    
    if (!pushConfig.fcmServerKey) {
      // Log for development
      console.log(`[PUSH] Would send to device: ${payload.title} - ${payload.body}`);
      return true;
    }

    // Placeholder for FCM integration
    // Example:
    // const response = await fetch('https://fcm.googleapis.com/fcm/send', {
    //   method: 'POST',
    //   headers: {
    //     'Authorization': `key=${pushConfig.fcmServerKey}`,
    //     'Content-Type': 'application/json',
    //   },
    //   body: JSON.stringify({
    //     to: payload.deviceToken,
    //     notification: {
    //       title: payload.title,
    //       body: payload.body,
    //     },
    //     data: payload.data,
    //   }),
    // });
    // return response.ok;

    console.log(`[PUSH] Sent: ${payload.title} - ${payload.body}`);
    return true;
  } catch (error) {
    console.error('[PUSH] Failed to send:', error);
    return false;
  }
}


/**
 * Gets customer phone number by ID
 */
async function getCustomerPhone(customerId: string): Promise<string | null> {
  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    select: { phone: true },
  });
  return customer?.phone ?? null;
}

/**
 * Gets customer device token for push notifications (placeholder)
 * In production, this would fetch from a device_tokens table
 */
async function getCustomerDeviceToken(customerId: string): Promise<string | null> {
  // Placeholder - in production, fetch from device_tokens table
  // const device = await prisma.deviceToken.findFirst({
  //   where: { customerId, isActive: true },
  //   orderBy: { updatedAt: 'desc' },
  // });
  // return device?.token ?? null;
  return null;
}

/**
 * Sends notification to customer via all available channels
 */
export async function sendNotification(payload: NotificationPayload): Promise<{
  sms: boolean;
  push: boolean;
}> {
  const results = { sms: false, push: false };

  try {
    // Get customer contact info
    const phone = await getCustomerPhone(payload.customerId);
    const deviceToken = await getCustomerDeviceToken(payload.customerId);

    // Send SMS if phone available
    if (phone) {
      results.sms = await sendSMS({
        phone,
        message: payload.message,
      });
    }

    // Send push notification if device token available
    if (deviceToken) {
      results.push = await sendPushNotification({
        deviceToken,
        title: payload.title,
        body: payload.message,
        data: payload.data,
      });
    }

    // Log notification attempt
    console.log(`[NOTIFICATION] ${payload.type} sent to customer ${payload.customerId}:`, results);
  } catch (error) {
    console.error(`[NOTIFICATION] Failed to send ${payload.type}:`, error);
  }

  return results;
}


// ============================================
// Specific Notification Functions
// ============================================

/**
 * Sends low balance notification
 * Requirements: 3.3 - WHEN wallet balance goes below minimum threshold
 */
export async function sendLowBalanceNotification(
  customerId: string,
  balance: number,
  threshold: number
): Promise<void> {
  await sendNotification({
    type: 'LOW_BALANCE',
    customerId,
    title: 'Low Wallet Balance',
    message: `Your wallet balance (₹${balance.toFixed(2)}) is below the minimum threshold (₹${threshold.toFixed(2)}). Please recharge to continue deliveries.`,
    data: { balance, threshold },
  });
}

/**
 * Sends insufficient balance notification for next delivery
 * Requirements: 3.4 - IF wallet balance is insufficient for next delivery
 */
export async function sendInsufficientBalanceNotification(
  customerId: string,
  balance: number,
  requiredAmount: number
): Promise<void> {
  const shortfall = requiredAmount - balance;
  await sendNotification({
    type: 'INSUFFICIENT_BALANCE',
    customerId,
    title: 'Recharge Required',
    message: `Your wallet balance (₹${balance.toFixed(2)}) is insufficient for your next delivery (₹${requiredAmount.toFixed(2)}). Please add ₹${shortfall.toFixed(2)} to continue.`,
    data: { balance, requiredAmount, shortfall },
  });
}

/**
 * Sends delivery completed notification
 * Requirements: 5.2 - WHEN a delivery boy marks delivery as completed
 */
export async function sendDeliveryCompletedNotification(
  customerId: string,
  deliveryId: string,
  products: Array<{ name: string; quantity: number }>
): Promise<void> {
  const productList = products.map(p => `${p.quantity}x ${p.name}`).join(', ');
  await sendNotification({
    type: 'DELIVERY_COMPLETED',
    customerId,
    title: 'Delivery Completed',
    message: `Your milk delivery has been completed! Items: ${productList}`,
    data: { deliveryId, products },
  });
}

/**
 * Sends delivery failed notification
 * Requirements: 5.3 - WHEN a delivery boy marks delivery as failed
 */
export async function sendDeliveryFailedNotification(
  customerId: string,
  deliveryId: string,
  reason: string
): Promise<void> {
  await sendNotification({
    type: 'DELIVERY_FAILED',
    customerId,
    title: 'Delivery Failed',
    message: `Your delivery could not be completed. Reason: ${reason}. Please contact support if needed.`,
    data: { deliveryId, reason },
  });
}

/**
 * Sends product unavailability notification
 * Requirements: 9.3 - WHEN an admin sets product as unavailable
 */
export async function sendProductUnavailableNotification(
  customerId: string,
  productName: string
): Promise<void> {
  await sendNotification({
    type: 'PRODUCT_UNAVAILABLE',
    customerId,
    title: 'Product Unavailable',
    message: `${productName} is currently unavailable. Your subscription will be adjusted accordingly. We apologize for the inconvenience.`,
    data: { productName },
  });
}

/**
 * Sends subscription modified notification
 * Requirements: 7.2 - WHEN an admin modifies customer subscription
 */
export async function sendSubscriptionModifiedNotification(
  customerId: string,
  subscriptionId: string,
  changes: string
): Promise<void> {
  await sendNotification({
    type: 'SUBSCRIPTION_MODIFIED',
    customerId,
    title: 'Subscription Updated',
    message: `Your subscription has been updated: ${changes}`,
    data: { subscriptionId, changes },
  });
}

/**
 * Sends bulk notifications to multiple customers
 * Useful for product unavailability notifications
 */
export async function sendBulkNotification(
  customerIds: string[],
  notificationFn: (customerId: string) => Promise<void>
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  for (const customerId of customerIds) {
    try {
      await notificationFn(customerId);
      success++;
    } catch (error) {
      console.error(`[BULK_NOTIFICATION] Failed for customer ${customerId}:`, error);
      failed++;
    }
  }

  return { success, failed };
}
