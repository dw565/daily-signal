import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/** Live runs against the real model and feeds. Spends tokens: run deliberately with `npm run test:live`. */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/empty.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/live/**/*.live.ts"],
    environment: "node",
    testTimeout: 600_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
