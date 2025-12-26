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
 * Gets a customer profile by ID
 */
export declare function getCustomerProfile(customerId: string): Promise<Customer>;
/**
 * Creates a customer profile (updates name/email for existing customer)
 */
export declare function createCustomerProfile(customerId: string, data: CustomerProfileInput): Promise<Customer>;
/**
 * Updates a customer profile
 */
export declare function updateCustomerProfile(customerId: string, data: Partial<CustomerProfileInput>): Promise<Customer>;
/**
 * Adds a new address for a customer
 */
export declare function addCustomerAddress(customerId: string, data: AddressInput): Promise<Address>;
/**
 * Updates an existing address
 */
export declare function updateCustomerAddress(customerId: string, addressId: string, data: Partial<AddressInput>): Promise<Address>;
/**
 * Deletes an address
 */
export declare function deleteCustomerAddress(customerId: string, addressId: string): Promise<void>;
/**
 * Gets all addresses for a customer
 */
export declare function getCustomerAddresses(customerId: string): Promise<Address[]>;
//# sourceMappingURL=customer.service.d.ts.map