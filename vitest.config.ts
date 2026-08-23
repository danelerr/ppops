import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "json-summary", "lcov"],
      thresholds: {
        statements: 57,
        branches: 50,
        functions: 59,
        lines: 59,
      },
    },
  },
});
