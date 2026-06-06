import { DEMO_PRODUCTS, type DemoProduct } from './demo-products';
import { STORE_TAXONOMY, type StoreCategory } from './category-taxonomy';

type CategorySnapshot = {
  slug: string;
  name: string;
  parent_slug: string | null;
};

type ProductSnapshot = {
  id: string;
  slug: string;
  name: string;
  category_slug: string;
  subcategory_slug: string | null;
  price_paisa: number;
  image_url: string | null;
  variant_id: string;
  variant_label: string;
  available_quantity: number;
};

const snapshots = import.meta.glob('./*-snapshot.json', { eager: true }) as Record<string, { default: unknown }>;

function readJson<T>(path: string): T[] | null {
  const module = snapshots[path];
  return Array.isArray(module?.default) ? module.default as T[] : null;
}

function categoriesFromSnapshot(rows: CategorySnapshot[]): StoreCategory[] {
  const parents = rows.filter(row => !row.parent_slug);
  return parents.map(parent => ({
    name: parent.name,
    slug: parent.slug,
    subcategories: rows
      .filter(row => row.parent_slug === parent.slug)
      .map(row => ({ name: row.name, slug: row.slug })),
  }));
}

function productsFromSnapshot(rows: ProductSnapshot[]): DemoProduct[] {
  return rows.map(row => ({
    id: row.id,
    slug: row.slug,
    title: row.name,
    categorySlug: row.category_slug,
    subcategorySlug: row.subcategory_slug ?? row.category_slug,
    pricePaisa: row.price_paisa,
    imageUrl: row.image_url ?? '/assets/product-zb-stitch.svg',
    variantId: row.variant_id,
    variantLabel: row.variant_label,
    availableQuantity: row.available_quantity,
  }));
}

const categorySnapshot = readJson<CategorySnapshot>('./categories-snapshot.json');
const productSnapshot = readJson<ProductSnapshot>('./products-snapshot.json');
const validCategorySnapshot = categorySnapshot?.every(row => typeof row.slug === 'string' && typeof row.name === 'string' && 'parent_slug' in row);
const validProductSnapshot = productSnapshot?.every(row =>
  typeof row.id === 'string' &&
  typeof row.slug === 'string' &&
  typeof row.name === 'string' &&
  typeof row.category_slug === 'string' &&
  typeof row.variant_id === 'string' &&
  typeof row.variant_label === 'string' &&
  Number.isSafeInteger(row.price_paisa) &&
  Number.isSafeInteger(row.available_quantity)
);

export const CATALOG_CATEGORIES = categorySnapshot?.length && validCategorySnapshot ? categoriesFromSnapshot(categorySnapshot) : STORE_TAXONOMY;
export const CATALOG_PRODUCTS = productSnapshot?.length && validProductSnapshot ? productsFromSnapshot(productSnapshot) : DEMO_PRODUCTS;

export function productsForCatalogCategory(categorySlug: string) {
  return CATALOG_PRODUCTS.filter((product) => product.categorySlug === categorySlug || product.subcategorySlug === categorySlug);
}
