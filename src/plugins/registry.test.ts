import path from "node:path";
import { describe, expect, it } from "vitest";
import { createPluginRegistry } from "./registry.js";
import type { PluginRecord } from "./registry.js";
import type { PluginRuntime } from "./runtime/types.js";

describe("plugin registry", () => {
  describe("resolvePath", () => {
    it("resolves relative paths against plugin directory, not cwd", () => {
      const mockRecord: PluginRecord = {
        id: "test-plugin",
        name: "Test Plugin",
        source: "/path/to/plugin/dir/index.ts",
        origin: "installed",
        enabled: true,
        status: "loaded",
        toolNames: [],
        hookNames: [],
        channelIds: [],
        providerIds: [],
        gatewayMethods: [],
        cliCommands: [],
        services: [],
        commands: [],
        httpRoutes: 0,
        hookCount: 0,
        configSchema: false,
      };

      const mockRuntime: PluginRuntime = {
        version: "test",
        gateway: {} as unknown as PluginRuntime["gateway"],
        logger: {} as unknown as PluginRuntime["logger"],
        env: "production",
      };

      const { createApi } = createPluginRegistry({
        runtime: mockRuntime,
        logger: {} as unknown as Parameters<typeof createPluginRegistry>[0]["logger"],
        pluginScopeCapture: () => {},
        serviceManager: {} as unknown as Parameters<
          typeof createPluginRegistry
        >[0]["serviceManager"],
        dock: {} as unknown as Parameters<typeof createPluginRegistry>[0]["dock"],
      });

      const api = createApi(mockRecord, {
        config: {},
        pluginConfig: {},
      });

      // Relative path should resolve against plugin directory
      const relativePath = "./sibling-file.mjs";
      const resolved = api.resolvePath(relativePath);
      expect(resolved).toBe("/path/to/plugin/dir/sibling-file.mjs");

      // Should not use process.cwd()
      expect(resolved).not.toBe(path.resolve(process.cwd(), relativePath));
    });

    it("resolves absolute paths unchanged", () => {
      const mockRecord: PluginRecord = {
        id: "test-plugin",
        name: "Test Plugin",
        source: "/path/to/plugin/dir/index.ts",
        origin: "installed",
        enabled: true,
        status: "loaded",
        toolNames: [],
        hookNames: [],
        channelIds: [],
        providerIds: [],
        gatewayMethods: [],
        cliCommands: [],
        services: [],
        commands: [],
        httpRoutes: 0,
        hookCount: 0,
        configSchema: false,
      };

      const mockRuntime: PluginRuntime = {
        version: "test",
        gateway: {} as unknown as PluginRuntime["gateway"],
        logger: {} as unknown as PluginRuntime["logger"],
        env: "production",
      };

      const { createApi } = createPluginRegistry({
        runtime: mockRuntime,
        logger: {} as unknown as Parameters<typeof createPluginRegistry>[0]["logger"],
        pluginScopeCapture: () => {},
        serviceManager: {} as unknown as Parameters<
          typeof createPluginRegistry
        >[0]["serviceManager"],
        dock: {} as unknown as Parameters<typeof createPluginRegistry>[0]["dock"],
      });

      const api = createApi(mockRecord, {
        config: {},
        pluginConfig: {},
      });

      // Absolute path should be handled by resolveUserPath
      const absolutePath = "/absolute/path/to/file.txt";
      const resolved = api.resolvePath(absolutePath);
      expect(resolved).toBe(absolutePath);
    });

    it("handles tilde paths through resolveUserPath", () => {
      const mockRecord: PluginRecord = {
        id: "test-plugin",
        name: "Test Plugin",
        source: "/path/to/plugin/dir/index.ts",
        origin: "installed",
        enabled: true,
        status: "loaded",
        toolNames: [],
        hookNames: [],
        channelIds: [],
        providerIds: [],
        gatewayMethods: [],
        cliCommands: [],
        services: [],
        commands: [],
        httpRoutes: 0,
        hookCount: 0,
        configSchema: false,
      };

      const mockRuntime: PluginRuntime = {
        version: "test",
        gateway: {} as unknown as PluginRuntime["gateway"],
        logger: {} as unknown as PluginRuntime["logger"],
        env: "production",
      };

      const { createApi } = createPluginRegistry({
        runtime: mockRuntime,
        logger: {} as unknown as Parameters<typeof createPluginRegistry>[0]["logger"],
        pluginScopeCapture: () => {},
        serviceManager: {} as unknown as Parameters<
          typeof createPluginRegistry
        >[0]["serviceManager"],
        dock: {} as unknown as Parameters<typeof createPluginRegistry>[0]["dock"],
      });

      const api = createApi(mockRecord, {
        config: {},
        pluginConfig: {},
      });

      // Tilde path should be handled by resolveUserPath (which expands ~)
      const tildePath = "~/some/file.txt";
      const resolved = api.resolvePath(tildePath);
      // resolveUserPath will expand ~ to the actual home directory
      expect(resolved).toContain("/some/file.txt");
      expect(resolved).not.toContain("~");
    });

    it("handles relative paths with parent directory references", () => {
      const mockRecord: PluginRecord = {
        id: "test-plugin",
        name: "Test Plugin",
        source: "/path/to/plugin/dir/index.ts",
        origin: "installed",
        enabled: true,
        status: "loaded",
        toolNames: [],
        hookNames: [],
        channelIds: [],
        providerIds: [],
        gatewayMethods: [],
        cliCommands: [],
        services: [],
        commands: [],
        httpRoutes: 0,
        hookCount: 0,
        configSchema: false,
      };

      const mockRuntime: PluginRuntime = {
        version: "test",
        gateway: {} as unknown as PluginRuntime["gateway"],
        logger: {} as unknown as PluginRuntime["logger"],
        env: "production",
      };

      const { createApi } = createPluginRegistry({
        runtime: mockRuntime,
        logger: {} as unknown as Parameters<typeof createPluginRegistry>[0]["logger"],
        pluginScopeCapture: () => {},
        serviceManager: {} as unknown as Parameters<
          typeof createPluginRegistry
        >[0]["serviceManager"],
        dock: {} as unknown as Parameters<typeof createPluginRegistry>[0]["dock"],
      });

      const api = createApi(mockRecord, {
        config: {},
        pluginConfig: {},
      });

      // Relative path with parent directory reference
      const relativePath = "../shared/utils.js";
      const resolved = api.resolvePath(relativePath);
      expect(resolved).toBe("/path/to/plugin/shared/utils.js");
    });
  });
});
