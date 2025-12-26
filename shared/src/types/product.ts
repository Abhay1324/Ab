// Product Types
export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  unit: string;
  isAvailable: boolean;
  createdAt: Date;
}

export interface ProductInput {
  name: string;
  description: string;
  price: number;
  unit: string;
  isAvailable?: boolean;
}
