export type StoreCategory = {
  name: string;
  slug: string;
  subcategories: Array<{ name: string; slug: string }>;
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export const STORE_TAXONOMY: StoreCategory[] = [
  {
    name: "Pakistani Collection",
    slug: "pakistani-collection",
    subcategories: ["Bin Sayed", "Sadabahar", "Other Pakistani Brands"].map((name) => ({ name, slug: slugify(name) })),
  },
  {
    name: "Indian Collection",
    slug: "indian-collection",
    subcategories: ["Indian Party Wear", "Indian Three-Piece", "Indian Kurti Collection", "Other Indian Brands"].map((name) => ({ name, slug: slugify(name) })),
  },
  {
    name: "ZB Stitch",
    slug: "zb-stitch",
    subcategories: ["ZB Ready-to-Wear", "ZB Custom Stitch", "ZB Premium Collection", "ZB Exclusive Design"].map((name) => ({ name, slug: slugify(name) })),
  },
  {
    name: "Jewelry",
    slug: "jewelry",
    subcategories: ["Earrings", "Necklace Set", "Bangles & Bracelets", "Rings", "Bridal Jewelry"].map((name) => ({ name, slug: slugify(name) })),
  },
  {
    name: "Bags",
    slug: "bags",
    subcategories: ["Handbags", "Clutches", "Shoulder Bags", "Party Bags"].map((name) => ({ name, slug: slugify(name) })),
  },
];

export const FLAT_CATEGORY_FILTERS = STORE_TAXONOMY.flatMap((category) => [
  { name: category.name, slug: category.slug, parent: null },
  ...category.subcategories.map((subcategory) => ({ ...subcategory, parent: category.slug })),
]);
