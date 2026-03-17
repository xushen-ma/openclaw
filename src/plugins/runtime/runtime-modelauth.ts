import { getApiKeyForModel, resolveApiKeyForProvider } from "../../agents/model-auth.js";
import type { PluginRuntimeCore } from "./types-core.js";

type GetApiKeyForModelParams = Parameters<typeof getApiKeyForModel>[0];
type ResolveApiKeyForProviderParams = Parameters<typeof resolveApiKeyForProvider>[0];

export function createRuntimeModelAuth(): PluginRuntimeCore["modelAuth"] {
  return {
    getApiKeyForModel: async (params: GetApiKeyForModelParams) => getApiKeyForModel(params),
    resolveApiKeyForProvider: async (params: ResolveApiKeyForProviderParams) =>
      resolveApiKeyForProvider(params),
  };
}
