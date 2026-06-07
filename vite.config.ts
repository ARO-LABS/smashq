import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "child_process";

function getGitHash(): string {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "unknown";
  }
}

export default defineConfig(async () => ({
  plugins: [react()],
  define: {
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 16)),
    __GIT_HASH__: JSON.stringify(getGitHash()),
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Isolate zustand (incl. its `persist`/`createJSONStorage`
          // middleware) into its own leaf vendor chunk. Without this pin,
          // Rollup is free to co-bundle the `persist` binding into a STORE
          // chunk (e.g. uiStore). The settingsStore chunk then reads that
          // `persist` binding at module-init — and if the binding's chunk has
          // not initialized yet, the read hits a Temporal Dead Zone: the
          // runtime crash `Cannot access 'p' before initialization`, logged as
          // `settingsStore.hydration`. A standalone leaf chunk has no inbound
          // store dependency, so `persist` is always initialized before any
          // consumer evaluates — killing that cross-chunk TDZ class.
          'vendor-zustand': ['zustand'],
          'vendor-xterm': ['@xterm/xterm', '@xterm/addon-fit', '@xterm/addon-web-links'],
          'vendor-motion': ['framer-motion'],
          'vendor-react': ['react', 'react-dom'],
          'vendor-codemirror': ['@uiw/react-codemirror', '@codemirror/lang-markdown'],
          'vendor-markdown': ['markdown-it', 'dompurify'],
        },
      },
    },
  },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
