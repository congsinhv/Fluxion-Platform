import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Standalone test config — deliberately NOT reusing vite.config.ts, whose
// CSP plugin and `define: { global }` are browser-runtime concerns that would
// pollute the jsdom test environment. `css: false` skips Tailwind's @tailwind
// directives, which the test transformer cannot process.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "src") },
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
