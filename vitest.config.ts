import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 15000,
    hookTimeout: 30000,
    // Los tests de integración con Postgres se saltan si no hay DATABASE_URL
    passWithNoTests: false,
  },
});
