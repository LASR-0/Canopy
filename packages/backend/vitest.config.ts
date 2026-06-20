import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Pick up colocated unit tests and the integration test folder
    include: [
      "src/**/*.test.ts",
      "test/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/index.ts",         // entry point, no logic to test
        "src/store/schema.ts",  // pure table definitions
        "**/*.test.ts",
      ],
      thresholds: {
        lines: 70,
        functions: 70,
      },
    },
  },
});
