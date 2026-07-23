import { buildJsonPluginConfigSchema } from "openclaw/plugin-sdk/plugin-entry";
import { DEFAULT_AGENT_HEADER, type OvAgentRouting, type OvHttpConfig } from "./ov-http.js";
import type { SessionFallbackConfig } from "./session-store.js";

export const QuickMemoryPluginConfigJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    perAgentOvBaseUrl: { type: "string" },
    agentRouting: { type: "string", enum: ["header", "query", "path"], default: "header" },
    agentHeaderName: { type: "string", default: DEFAULT_AGENT_HEADER },
    legacyOvBaseUrl: { type: "string" },
    requestTimeoutMs: { type: "integer", minimum: 1000, maximum: 60000, default: 10000 },
    statsLogPath: { type: "string" },
    sessionFallback: {
      type: "object",
      additionalProperties: false,
      properties: {
        enabled: { type: "boolean", default: false },
        memoryRoot: { type: "string" },
        pythonBin: { type: "string" },
        timeoutMs: { type: "integer", minimum: 1000, maximum: 60000, default: 15000 },
      },
    },
  },
} as const;

export const quickMemoryPluginConfigSchema = buildJsonPluginConfigSchema(
  QuickMemoryPluginConfigJsonSchema,
);

type RawConfig = Record<string, unknown>;

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

export function resolveQuickMemoryConfig(raw: unknown): {
  httpConfig: OvHttpConfig;
  sessionFallback: SessionFallbackConfig;
  statsLogPath?: string;
} {
  const config = raw && typeof raw === "object" ? (raw as RawConfig) : {};
  const sessionFallback =
    config.sessionFallback && typeof config.sessionFallback === "object"
      ? (config.sessionFallback as RawConfig)
      : {};
  return {
    httpConfig: {
      perAgentBaseUrl: stringValue(config.perAgentOvBaseUrl),
      legacyBaseUrl: stringValue(config.legacyOvBaseUrl),
      agentRouting:
        config.agentRouting === "query" || config.agentRouting === "path"
          ? (config.agentRouting as OvAgentRouting)
          : "header",
      agentHeaderName: stringValue(config.agentHeaderName) ?? DEFAULT_AGENT_HEADER,
      requestTimeoutMs: numberValue(config.requestTimeoutMs, 10_000),
    },
    sessionFallback: {
      enabled: sessionFallback.enabled === true,
      memoryRoot: stringValue(sessionFallback.memoryRoot),
      pythonBin: stringValue(sessionFallback.pythonBin),
      timeoutMs: numberValue(sessionFallback.timeoutMs, 15_000),
    },
    statsLogPath: stringValue(config.statsLogPath),
  };
}
