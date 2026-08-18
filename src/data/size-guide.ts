export type SizeGuideChart = {
  readonly id: "pant" | "dress";
  readonly label: string;
  readonly caption: string;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly [size: string, ...measurements: string[]])[];
};

export const SIZE_GUIDE_CHARTS = [
  {
    id: "pant",
    label: "Pant Size Chart",
    caption: "Pant product measurements in inches",
    headers: ["Size", "Waist", "Length", "Hip", "Thigh", "Leg Open"],
    rows: [
      ["S-38", "13", "38", "24", "12", "8/9"],
      ["M-40,42", "14", "40", "26", "14", "8/9"],
      ["L-44,46", "14", "39", "25", "13", "8/9"],
      ["XL-48", "15", "39", "27", "13", "8/9"],
    ],
  },
  {
    id: "dress",
    label: "Dress Size Chart",
    caption: "Dress product measurements in inches",
    headers: ["Size", "Bust", "Waist", "Hip", "Sleeve Length", "Full Length"],
    rows: [
      ["S-38", "20", "21", "22", "22", "45"],
      ["M-40,42", "21", "21", "23", "22", "48"],
      ["L-44,46", "23", "23", "24", "23", "48"],
      ["XL-48", "23", "24", "24", "24", "50"],
    ],
  },
] as const satisfies readonly SizeGuideChart[];

export const SIZE_GUIDE_CUSTOMER_NOTE =
  "These are standard product measurements, not body measurements. Measure a similar well-fitting garment and compare the measurements before selecting S-38, M-40/42, L-44/46, or XL-48. Small variations may occur due to the production process.";
