/**
 * Agent Invocation SDK for OpenClaw Plugins
 *
 * Provides a clean internal API for plugins to invoke agents without HTTP fetch.
 * This uses the PluginRuntime.subagent interface that's already exposed to plugins.
 *
 * NOTE: The actual implementation is in the plugin registry (src/plugins/registry.ts).
 * This file provides type definitions and re-exports for plugin developers.
 */

import type { PluginRuntime } from "../plugins/runtime/types.js";
import type { PluginAgentInvokeOptions, PluginAgentInvokeResult } from "../plugins/types.js";

// Message format for agent invocation
export interface AgentMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// Re-export options and result types for plugin developers
export type { PluginAgentInvokeOptions as AgentInvokeOptions };
export type { PluginAgentInvokeResult as AgentInvokeResult };

/**
 * Invoke an agent directly (non-streaming)
 *
 * This is the proper way for extensions to call agents without HTTP fetch.
 * Uses the PluginRuntime.subagent interface.
 *
 * NOTE: This function is implemented in the plugin registry and attached to
 * api.invokeAgent at runtime. This declaration provides TypeScript support.
 */
export async function invokeAgent(
  _runtime: PluginRuntime,
  _opts: PluginAgentInvokeOptions,
): Promise<PluginAgentInvokeResult> {
  // This is a type declaration only - actual implementation is in registry.ts
  // The implementation is attached to api.invokeAgent when the plugin registers
  throw new Error(
    "invokeAgent is implemented in the plugin registry and accessed via api.invokeAgent",
  );
}

/**
 * Invoke an agent with streaming response
 *
 * Returns a ReadableStream that emits SSE-compatible chunks.
 *
 * NOTE: This function is implemented in the plugin registry and attached to
 * api.invokeAgentStream at runtime. This declaration provides TypeScript support.
 */
export async function invokeAgentStream(
  _runtime: PluginRuntime,
  _opts: PluginAgentInvokeOptions,
): Promise<ReadableStream<Uint8Array>> {
  // This is a type declaration only - actual implementation is in registry.ts
  throw new Error(
    "invokeAgentStream is implemented in the plugin registry and accessed via api.invokeAgentStream",
  );
}
