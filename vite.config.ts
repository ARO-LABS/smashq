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
          // Keep zustand (state core + persist/createJSONStorage middleware) in
          // its own vendor chunk — every store imports it, so isolating it keeps
          // it out of the per-store chunks. Pure chunking hygiene; the
          // settingsStore hydration TDZ is fixed at its source (settingsStore.ts
          // defers the onRehydrateStorage setState off the create() call), NOT
          // here — chunk layout never mattered to that bug.
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
