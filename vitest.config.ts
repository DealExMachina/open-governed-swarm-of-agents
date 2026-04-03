import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/seed-data/**", "**/*.d.ts", "**/*.test.ts"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
