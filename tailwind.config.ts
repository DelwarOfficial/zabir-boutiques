import type { Config } from "tailwindcss";

export default {
  theme: {
    extend: {
      colors: {
        // Brand colors
        brand: {
          DEFAULT: "hsl(var(--brand-h) var(--brand-s) var(--brand-l))",
          hover: "hsl(var(--brand-hover-h) var(--brand-hover-s) var(--brand-hover-l))",
          light: "hsl(var(--brand-light-h) var(--brand-light-s) var(--brand-light-l))",
        },
        // Surface colors (mapped from CSS tokens)
        bg: {
          DEFAULT: "var(--bg-storefront)",
          subtle: "var(--bg-storefront-subtle)",
        },
        surface: {
          DEFAULT: "var(--surface-storefront)",
          soft: "var(--surface-storefront-soft)",
        },
        // Text colors
        ink: {
          DEFAULT: "var(--ink-storefront)",
          secondary: "var(--ink-storefront-secondary)",
        },
        // Border colors
        border: {
          DEFAULT: "var(--border-storefront)",
          soft: "var(--border-storefront-soft)",
        },
        // Semantic colors
        success: {
          DEFAULT: "var(--success-storefront)",
        },
        danger: {
          DEFAULT: "var(--danger-storefront)",
        },
        warning: {
          DEFAULT: "var(--warning-storefront)",
        },
      },
      spacing: {
        xs: "0.25rem", // 4px
        sm: "0.5rem", // 8px
        md: "1rem", // 16px
        lg: "1.5rem", // 24px
        xl: "2rem", // 32px
        "2xl": "2.5rem", // 40px
        "3xl": "3rem", // 48px
      },
      borderRadius: {
        sm: "var(--radius-storefront-sm)",
        md: "var(--radius-storefront-md)",
        lg: "var(--radius-storefront-lg)",
      },
      boxShadow: {
        sm: "var(--shadow-storefront-sm)",
        md: "var(--shadow-storefront-md)",
        lg: "var(--shadow-storefront-lg)",
        brand: "0 0 0 3px var(--brand-storefront-glow)",
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "sans-serif",
        ],
        serif: ["Georgia", '"Times New Roman"', "serif"],
      },
      fontSize: {
        // Typographic scale
        xs: ["0.75rem", { lineHeight: "1.25rem" }],
        sm: ["0.875rem", { lineHeight: "1.375rem" }],
        base: ["1rem", { lineHeight: "1.5rem" }],
        lg: ["1.125rem", { lineHeight: "1.75rem" }],
        xl: ["1.25rem", { lineHeight: "1.75rem" }],
        "2xl": ["1.5rem", { lineHeight: "2rem" }],
        "3xl": ["1.875rem", { lineHeight: "2.25rem" }],
        "4xl": ["2.25rem", { lineHeight: "2.5rem" }],
      },
      letterSpacing: {
        tight: "-0.02em",
        normal: "0.01em",
        wide: "0.02em",
      },
      screens: {
        xs: "360px",
        sm: "640px",
        md: "1024px",
        lg: "1280px",
        xl: "1536px",
      },
      animation: {
        "fade-up": "fadeUp 360ms cubic-bezier(0.2, 0.7, 0.2, 1) both",
        "fade-in": "fadeIn 240ms ease both",
        pop: "pop 320ms cubic-bezier(0.2, 0.8, 0.2, 1) both",
        "pulse-ring": "pulseRing 1.2s ease-out infinite",
      },
      keyframes: {
        fadeUp: {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        fadeIn: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        pop: {
          "0%": { transform: "scale(0.85)" },
          "60%": { transform: "scale(1.08)" },
          "100%": { transform: "scale(1)" },
        },
        pulseRing: {
          "0%": { boxShadow: "0 0 0 0 var(--brand-storefront-glow)" },
          "100%": { boxShadow: "0 0 0 12px transparent" },
        },
      },
      aspectRatio: {
        "4/5": "4 / 5",
        "3/4": "3 / 4",
      },
      zIndex: {
        0: "0",
        10: "10",
        20: "20",
        30: "30",
        40: "40",
        50: "50",
        auto: "auto",
      },
    },
  },
  corePlugins: {
    preflight: false, // Already handled by global.css
  },
} satisfies Config;
