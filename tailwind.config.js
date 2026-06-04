/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        /* ── Accent (single primary, CSS-variable-backed) ── */
        accent: "var(--color-accent)",
        "accent-light": "var(--color-accent-light)",
        "accent-dark": "var(--color-accent-dark)",
        "accent-subtle": "var(--color-accent-subtle)",

        /* ── Semantic ── */
        success: "var(--color-success)",
        error: "var(--color-error)",
        warning: "var(--color-warning)",
        info: "var(--color-info)",

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
        "neon-purple":  "oklch(60% 0.20 300)",
        "neon-orange":  "var(--color-warning)",
        "dark-bg":     "var(--surface-base)",
        "dark-card":   "var(--surface-raised)",
        "dark-border": "var(--neutral-700)",
      },
      fontFamily: {
        display: ["Inter", "Segoe UI", "system-ui", "sans-serif"],
        body:    ["Inter", "Segoe UI", "system-ui", "sans-serif"],
        mono:    ["JetBrains Mono", "Fira Code", "Consolas", "monospace"],
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
        "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
        "in-expo":  "cubic-bezier(0.7, 0, 0.84, 0)",
      },
    },
  },
  plugins: [],
};
