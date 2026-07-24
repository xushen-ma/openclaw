import { defineConfig } from "vitest/config";

export default defineConfig({
  root: import.meta.dirname,
  resolve: {
    alias: {
      "openclaw/plugin-sdk/plugin-entry": "./test-support/plugin-entry.ts",
      "openclaw/plugin-sdk/tool-plugin": "./test-support/tool-plugin.ts",
    },
  },
  test: {
    dir: import.meta.dirname,
    include: ["src/**/*.test.ts", "*.test.mjs"],
    globals: false,
    environment: "node",
  },
});
