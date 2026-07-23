import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { quickMemoryPluginConfigSchema, resolveQuickMemoryConfig } from "./config.js";
import { createQuickMemorySearchTool, createQuickSessionSearchTool } from "./tools.js";

export default definePluginEntry({
  id: "quick-memory-search",
  name: "Quick Memory Search",
  description: "Fast per-agent OpenViking memory and session search tools.",
  configSchema: quickMemoryPluginConfigSchema,
  reload: {
    restartPrefixes: ["plugins.entries.quick-memory-search"],
  },
  register(api) {
    const config = resolveQuickMemoryConfig(api.pluginConfig);
    api.registerTool((ctx) =>
      createQuickMemorySearchTool({
        httpConfig: config.httpConfig,
        agentId: ctx.agentId ?? "main",
        statsLogPath: config.statsLogPath,
      }),
    );
    api.registerTool((ctx) =>
      createQuickSessionSearchTool({
        httpConfig: config.httpConfig,
        agentId: ctx.agentId ?? "main",
        sessionFallback: config.sessionFallback,
        statsLogPath: config.statsLogPath,
      }),
    );
    api.registerService({
      id: "quick-memory-search.status",
      start: () => {},
      stop: () => {},
    });
    api.registerGatewayMethod(
      "quick-memory-search.status",
      ({ respond }) => {
        respond(true, {
          ok: true,
          perAgentConfigured: Boolean(config.httpConfig.perAgentBaseUrl),
          legacyConfigured: Boolean(config.httpConfig.legacyBaseUrl),
          agentRouting: config.httpConfig.agentRouting,
          sessionFallbackEnabled: config.sessionFallback.enabled,
          statsLogging: Boolean(config.statsLogPath),
        });
      },
      { scope: "operator.read" },
    );
    api.logger.info(
      [
        "quick-memory-search registered",
        `perAgent=${config.httpConfig.perAgentBaseUrl ? "configured" : "disabled"}`,
        `legacy=${config.httpConfig.legacyBaseUrl ? "configured" : "disabled"}`,
        `sessionFallback=${config.sessionFallback.enabled ? "enabled" : "disabled"}`,
      ].join(" "),
    );
  },
});

export { resolveQuickMemoryConfig } from "./config.js";
export { normalizeAgentId, resolveOvRequests } from "./ov-http.js";
export { createQuickMemorySearchTool, createQuickSessionSearchTool } from "./tools.js";
export { resolveSessionStorePath } from "./session-store.js";
