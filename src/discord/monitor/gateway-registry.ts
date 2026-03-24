import type { GatewayPlugin } from "@buape/carbon/gateway";

/**
 * Module-level registry of active Discord GatewayPlugin instances.
 * Bridges the gap between agent tool handlers (which only have REST access)
 * and the gateway WebSocket (needed for operations like updatePresence).
 * Follows the same pattern as presence-cache.ts.
 */
export type DiscordGatewayInstanceMetadata = {
  accountId?: string;
  botUserId?: string;
  monitorInstanceId?: string;
  startedAt?: string;
  pid?: number;
};

type GatewayRegistryEntry = {
  gateway: GatewayPlugin;
  metadata?: DiscordGatewayInstanceMetadata;
};

const gatewayRegistry = new Map<string, GatewayRegistryEntry>();

// Sentinel key for the default (unnamed) account. Uses a prefix that cannot
// collide with user-configured account IDs.
const DEFAULT_ACCOUNT_KEY = "\0__default__";

function resolveAccountKey(accountId?: string): string {
  return accountId ?? DEFAULT_ACCOUNT_KEY;
}

/** Register a GatewayPlugin instance for an account. */
export function registerGateway(
  accountId: string | undefined,
  gateway: GatewayPlugin,
  metadata?: DiscordGatewayInstanceMetadata,
): { replaced: boolean; previous?: DiscordGatewayInstanceMetadata } {
  const key = resolveAccountKey(accountId);
  const previous = gatewayRegistry.get(key);
  gatewayRegistry.set(key, { gateway, metadata });
  return {
    replaced: Boolean(previous),
    previous: previous?.metadata,
  };
}

/** Unregister a GatewayPlugin instance for an account. */
export function unregisterGateway(accountId?: string): void {
  gatewayRegistry.delete(resolveAccountKey(accountId));
}

/** Get the GatewayPlugin for an account. Returns undefined if not registered. */
export function getGateway(accountId?: string): GatewayPlugin | undefined {
  return gatewayRegistry.get(resolveAccountKey(accountId))?.gateway;
}

/** Get registered instance metadata for an account. */
export function getGatewayMetadata(accountId?: string): DiscordGatewayInstanceMetadata | undefined {
  return gatewayRegistry.get(resolveAccountKey(accountId))?.metadata;
}

/** Clear all registered gateways (for testing). */
export function clearGateways(): void {
  gatewayRegistry.clear();
}
