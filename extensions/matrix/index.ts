import type { OpenClawPluginApi } from "openclaw/plugin-sdk/matrix";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk/matrix";
import { matrixPlugin } from "./src/channel.js";
import { ensureMatrixCryptoRuntime, ensureMatrixSdkInstalled } from "./src/matrix/deps.js";
import { setMatrixRuntime } from "./src/runtime.js";

const plugin = {
  id: "matrix",
  name: "Matrix",
  description: "Matrix channel plugin (matrix-js-sdk)",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    setMatrixRuntime(api.runtime);
    void (async () => {
      try {
        await ensureMatrixSdkInstalled({
          runtime: {
            log: (message) => api.logger.info?.(String(message)),
            error: (message) => api.logger.error?.(String(message)),
            exit: (code) => {
              throw new Error(`matrix runtime requested exit(${code}) during dependency install`);
            },
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        api.logger.warn?.(`matrix: sdk dependency check failed: ${message}`);
      }

      try {
        await ensureMatrixCryptoRuntime({ log: api.logger.info });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        api.logger.warn?.(`matrix: crypto runtime bootstrap failed: ${message}`);
      }
    })();
    api.registerChannel({ plugin: matrixPlugin });
  },
};

export default plugin;
