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
    include: ["src/**/*.test.ts"],
    globals: false,
    environment: "node",
  },
});
