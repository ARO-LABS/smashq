/**
 * Wraps a CSS-variable color so Tailwind opacity modifiers (bg-info/10) work.
 * A plain `var(--x)` is opaque — Tailwind cannot inject alpha into it and skips
 * the /NN variant entirely. color-mix + the <alpha-value> placeholder lets
 * Tailwind substitute the opacity (0.1) or 1 (no modifier → solid color).
 */
const alpha = (v) => `color-mix(in oklch, ${v} calc(<alpha-value> * 100%), transparent)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        /* ── Accent (single primary, CSS-variable-backed) ── */
        accent: alpha("var(--color-accent)"),
        "accent-light": "var(--color-accent-light)",
        "accent-dark": "var(--color-accent-dark)",
        "accent-subtle": "var(--color-accent-subtle)",

        /* ── Semantic ── */
        success: alpha("var(--color-success)"),
        error: alpha("var(--color-error)"),
        warning: alpha("var(--color-warning)"),
        info: alpha("var(--color-info)"),

        /* ── Category colors (Typ-/Source-Kodierung, aus der Palette) ── */
        "cat-azure":   alpha("var(--cat-azure)"),
        "cat-violet":  alpha("var(--cat-violet)"),
        "cat-amber":   alpha("var(--cat-amber)"),
        "cat-rose":    alpha("var(--cat-rose)"),
        "cat-emerald": alpha("var(--cat-emerald)"),

        /* ── Tinted Neutrals (switch with theme) ── */
        neutral: {
          50:  "var(--neutral-50)",
          100: "var(--neutral-100)",
          200: "var(--neutral-200)",
          300: "var(--neutral-300)",
          400: "var(--neutral-400)",
          500: "var(--neutral-500)",
          600: "var(--neutral-600)",
          700: "var(--neutral-700)",
          800: "var(--neutral-800)",
          900: "var(--neutral-900)",
          950: "var(--neutral-950)",
        },

        /* ── Surfaces ── */
        "surface-base":    "var(--surface-base)",
        "surface-raised":  "var(--surface-raised)",
        "surface-overlay": "var(--surface-overlay)",
        "surface-inset":   "var(--surface-inset)",

        /* ── Diff backgrounds ── */
        "diff-removed-bg":   "var(--diff-removed-bg)",
        "diff-added-bg":     "var(--diff-added-bg)",
        "diff-removed-emph": "var(--diff-removed-emph)",
        "diff-added-emph":   "var(--diff-added-emph)",

        /* ── Alpha variants (for opacity modifiers) ── */
        "accent-a10": "var(--accent-a10)",
        "accent-a15": "var(--accent-a15)",
        "accent-a40": "var(--accent-a40)",
        "accent-a05": "var(--accent-a05)",
        "accent-a30": "var(--accent-a30)",
        "success-a05": "var(--success-a05)",

        /* ── Hover overlay ── */
        "hover-overlay": "var(--hover-overlay)",

        /* ── Legacy aliases (for gradual migration) ── */
        "neon-green":  "var(--color-success)",
        "neon-blue":   "var(--color-accent)",
        "neon-orange":  "var(--color-warning)",
        "dark-bg":     "var(--surface-base)",
        "dark-card":   "var(--surface-raised)",
        "dark-border": "var(--neutral-700)",
      },
      fontFamily: {
        display: "var(--font-display)",
        body:    "var(--font-body)",
        mono:    "var(--font-mono)",
      },
      borderRadius: {
        xs: "var(--radius-xs)",
        sm: "var(--radius-sm)",
        DEFAULT: "var(--radius-md)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        full: "var(--radius-full)",
      },
      boxShadow: {
        hairline: "var(--shadow-hairline)",
        lift:     "var(--shadow-lift)",
        modal:    "var(--shadow-modal)",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "flow": "flow 2s linear infinite",
        "status-pulse": "status-pulse 2s cubic-bezier(0.65, 0, 0.35, 1) infinite",
        "spin-slow": "spin 1.5s linear infinite",
      },
      keyframes: {
        flow: {
          "0%": { strokeDashoffset: "100" },
          "100%": { strokeDashoffset: "0" },
        },
      },
      transitionTimingFunction: {
        "out-expo":    "var(--ease-out)",
        "in-expo":     "var(--ease-in)",
        "in-out-expo": "var(--ease-in-out)",
      },
      transitionDuration: {
        instant: "var(--duration-instant)",
        fast:    "var(--duration-fast)",
        base:    "var(--duration-base)",
        slow:    "var(--duration-slow)",
      },
      spacing: {
        xs:    "var(--space-xs)",
        sm:    "var(--space-sm)",
        md:    "var(--space-md)",
        lg:    "var(--space-lg)",
        xl:    "var(--space-xl)",
        "2xl": "var(--space-2xl)",
        "3xl": "var(--space-3xl)",
      },
    },
  },
  plugins: [],
};
