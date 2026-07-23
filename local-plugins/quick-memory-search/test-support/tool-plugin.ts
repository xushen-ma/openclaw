import { definePluginEntry, type AnyAgentTool } from "./plugin-entry.js";

const metadataSymbol = Symbol.for("openclaw.plugin-sdk.tool-plugin.metadata");

type ToolFactoryDefinition = {
  name: string;
  label?: string;
  description: string;
  parameters: Record<string, unknown>;
  optional?: boolean;
  factory: (context: {
    config: unknown;
    toolContext: { agentId?: string };
  }) => AnyAgentTool | AnyAgentTool[] | null | undefined;
};

export function defineToolPlugin(definition: {
  id: string;
  name: string;
  description: string;
  activation?: unknown;
  configSchema?: Record<string, unknown>;
  tools: (
    tool: (toolDefinition: ToolFactoryDefinition) => ToolFactoryDefinition,
  ) => readonly ToolFactoryDefinition[];
}) {
  const tools = [...definition.tools((toolDefinition) => toolDefinition)];
  const entry = definePluginEntry({
    id: definition.id,
    name: definition.name,
    description: definition.description,
    configSchema: definition.configSchema,
    register(api) {
      for (const tool of tools) {
        api.registerTool(
          (toolContext) => tool.factory({ config: api.pluginConfig, toolContext }),
          tool.optional ? { name: tool.name, optional: true } : { name: tool.name },
        );
      }
    },
  });
  Object.defineProperty(entry, metadataSymbol, {
    value: {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      activation: definition.activation,
      configSchema: definition.configSchema,
      tools: tools.map((tool) => ({
        name: tool.name,
        label: tool.label ?? tool.name,
        description: tool.description,
        parameters: tool.parameters,
        ...(tool.optional ? { optional: true } : {}),
      })),
    },
  });
  return entry;
}

export function getToolPluginMetadata(entry: unknown) {
  return entry && typeof entry === "object"
    ? (entry as { [metadataSymbol]?: unknown })[metadataSymbol]
    : undefined;
}
