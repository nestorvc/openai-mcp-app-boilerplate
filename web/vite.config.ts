/**
 * Vite configuration for development server.
 * Handles React components, Tailwind CSS processing, and dev server setup.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  build: {
    target: "es2022",
    sourcemap: true,
    minify: "esbuild",
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // Auto-discover components from src/
        main: "./src/index.tsx",
      },
      output: {
        format: "es",
        entryFileNames: "[name].js",
        assetFileNames: "[name].[ext]",
      },
    },
  },
});

