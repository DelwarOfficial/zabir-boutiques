import { CATALOG_CATEGORIES } from './catalog';

export type CollectionSnapshot = {
  slug: string;
  name: string;
  description: string;
};

/** Curated collections map to top-level catalog categories for launch snapshots. */
export const COLLECTIONS: CollectionSnapshot[] = CATALOG_CATEGORIES.map((category) => ({
  slug: category.slug,
  name: category.name,
  description: `${category.name} picks from Zabir Boutiques.`,
}));