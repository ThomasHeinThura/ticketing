import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { i18nNamespaceGroups } from "./vite/i18n-namespace-groups";

export default defineConfig({
  plugins: [
    react(),
    i18nNamespaceGroups({ i18nDir: path.resolve(__dirname, "../../i18n") }),
  ],
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      enabled: false,
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@i18n": path.resolve(__dirname, "../../i18n"),
    },
  },
});
