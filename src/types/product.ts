export interface Product {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  pricePaisa: number;
  comparePricePaisa: number | null;
  status: 'draft' | 'published' | 'archived';
  isFeatured: boolean;
  metaTitle: string | null;
  metaDescription: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface ProductImage {
  id: string;
  productId: string;
  r2Key: string;
  altText: string | null;
  sortOrder: number;
  isCompressed: boolean;
  width: number | null;
  height: number | null;
}

export interface VariantInput {
  sku: string;
  size: string | null;
  color: string | null;
  pricePaisa: number | null;
  stock: number;
}

export interface CreateProductInput {
  name: string;
  slug?: string;
  description: string | null;
  categoryId: string | null;
  pricePaisa: number;
  comparePricePaisa: number | null;
  status: 'draft' | 'published';
  isFeatured: boolean;
  metaTitle: string | null;
  metaDescription: string | null;
  variants: VariantInput[];
}

export interface CreateProductResult {
  ok: true;
  productId: string;
  variantIds: string[];
}

export interface BulkGenerateInput {
  sizes: string[];
  colors: string[];
  basePricePaisa: number;
  baseStock: number;
  skuTemplate: string;
  productSlug: string;
}
