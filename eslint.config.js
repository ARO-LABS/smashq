import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  {
    ignores: ["dist/", "src-tauri/", "node_modules/", "target-c/"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": "warn",
      // Icons must flow through the central registry (src/utils/icons.ts) so
      // size/name/swap stays a one-file edit. The registry itself is exempted
      // by the override block below.
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "lucide-react",
              message:
                "Icons nur über src/utils/icons.ts (ICONS/ICON_SIZE/LucideIcon) importieren — direkter lucide-react-Import ist verboten.",
            },
          ],
        },
      ],
    },
  },
  {
    // The icon registry is the ONLY module allowed to import lucide-react directly.
    files: ["src/utils/icons.ts"],
    rules: {
      "@typescript-eslint/no-restricted-imports": "off",
    },
  },
  {
    // Node-only tooling scripts (.claude hooks, build scripts) — provide Node
    // globals and allow console output, which is their intended I/O channel.
    // Placed last so its rule overrides win over the shared block above.
    files: ["**/*.mjs"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        URL: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
    rules: {
      "no-console": "off",
    },
  },
);
