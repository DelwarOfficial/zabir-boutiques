import type { Paisa } from "../lib/money";

export type DemoProduct = {
  id: string;
  slug: string;
  title: string;
  categorySlug: string;
  subcategorySlug: string;
  pricePaisa: Paisa;
  imageUrl: string;
  variantId: string;
  variantLabel: string;
  availableQuantity: number;
};

export const DEMO_PRODUCTS: DemoProduct[] = [
  {
    id: "zb-pakistani-001",
    slug: "bin-sayed-embroidered-three-piece",
    title: "Bin Sayed Embroidered Three-Piece",
    categorySlug: "pakistani-collection",
    subcategorySlug: "bin-sayed",
    pricePaisa: 485000,
    imageUrl: "/assets/product-pakistani.svg",
    variantId: "var-bin-sayed-001-m",
    variantLabel: "M / Maroon",
    availableQuantity: 7,
  },
  {
    id: "zb-indian-001",
    slug: "indian-party-wear-georgette",
    title: "Indian Party Wear Georgette",
    categorySlug: "indian-collection",
    subcategorySlug: "indian-party-wear",
    pricePaisa: 625000,
    imageUrl: "/assets/product-indian.svg",
    variantId: "var-indian-party-001-l",
    variantLabel: "L / Emerald",
    availableQuantity: 4,
  },
  {
    id: "zb-stitch-001",
    slug: "zb-ready-to-wear-premium-kurti",
    title: "ZB Ready-to-Wear Premium Kurti",
    categorySlug: "zb-stitch",
    subcategorySlug: "zb-ready-to-wear",
    pricePaisa: 295000,
    imageUrl: "/assets/product-zb-stitch.svg",
    variantId: "var-zb-kurti-001-m",
    variantLabel: "M / Black",
    availableQuantity: 11,
  },
  {
    id: "zb-jewelry-001",
    slug: "bridal-jewelry-gold-tone-set",
    title: "Bridal Jewelry Gold Tone Set",
    categorySlug: "jewelry",
    subcategorySlug: "bridal-jewelry",
    pricePaisa: 345000,
    imageUrl: "/assets/product-jewelry.svg",
    variantId: "var-bridal-set-001",
    variantLabel: "One Size",
    availableQuantity: 3,
  },
];

export function productsForCategory(categorySlug: string) {
  return DEMO_PRODUCTS.filter((product) => product.categorySlug === categorySlug || product.subcategorySlug === categorySlug);
}
