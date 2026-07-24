import { defineToolPlugin } from "openclaw/plugin-sdk/tool-plugin";
import { QuickMemoryPluginConfigJsonSchema, resolveQuickMemoryConfig } from "./config.js";
import { createQuickMemorySearchTool, createQuickSessionSearchTool } from "./tools.js";

const quickMemoryEntry = defineToolPlugin({
  id: "quick-memory-search",
  name: "Quick Memory Search",
  description: "Fast per-agent OpenViking memory and session search tools.",
  activation: { onCapabilities: ["tool"] },
  configSchema: QuickMemoryPluginConfigJsonSchema,
  tools: (tool) => [
    tool({
      name: "quick_memory_search",
      label: "Quick Memory Search",
      description:
        "Fast semantic search across workspace knowledge. Use as the first-choice recall tool when available; falls back to memory_search if this returns unavailable.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", description: "Semantic search query for fast memory recall." },
          maxResults: { type: "integer", minimum: 1, description: "Maximum results to return." },
        },
        required: ["query"],
      },
      factory: ({ config, toolContext }) => {
        const resolved = resolveQuickMemoryConfig(config);
        return createQuickMemorySearchTool({
          httpConfig: resolved.httpConfig,
          agentId: toolContext.agentId ?? "main",
          statsLogPath: resolved.statsLogPath,
        });
      },
    }),
    tool({
      name: "quick_session_search",
      label: "Quick Session Search",
      description:
        "Fast semantic search across this agent's past sessions. Uses per-agent OpenViking HTTP first, with local OpenViking fallback only when explicitly enabled.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", description: "Semantic search query for past session recall." },
          maxResults: { type: "integer", minimum: 1, description: "Maximum results to return." },
        },
        required: ["query"],
      },
      factory: ({ config, toolContext }) => {
        const resolved = resolveQuickMemoryConfig(config);
        return createQuickSessionSearchTool({
          httpConfig: resolved.httpConfig,
          agentId: toolContext.agentId ?? "main",
          sessionFallback: resolved.sessionFallback,
          statsLogPath: resolved.statsLogPath,
        });
      },
    }),
  ],
});

const registerTools = quickMemoryEntry.register.bind(quickMemoryEntry);
quickMemoryEntry.register = (api) => {
  registerTools(api);
  const config = resolveQuickMemoryConfig(api.pluginConfig);
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
};

export default quickMemoryEntry;

export { resolveQuickMemoryConfig } from "./config.js";
export { normalizeAgentId, resolveOvRequests } from "./ov-http.js";
export { createQuickMemorySearchTool, createQuickSessionSearchTool } from "./tools.js";
export { resolveSessionStorePath } from "./session-store.js";
