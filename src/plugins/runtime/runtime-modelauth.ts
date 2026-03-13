import { getApiKeyForModel, resolveApiKeyForProvider } from "../../agents/model-auth.js";
import type { PluginRuntimeCore } from "./types-core.js";

export function createRuntimeModelAuth(): PluginRuntimeCore["modelAuth"] {
  return {
    getApiKeyForModel: async (params: { model: any; cfg?: any }) => {
      const { model, cfg } = params;
      return getApiKeyForModel({ model, cfg });
    },
    resolveApiKeyForProvider: async (params: { provider: string; cfg?: any }) => {
      const { provider, cfg } = params;
      return resolveApiKeyForProvider({ provider, cfg });
    },
  };
}
