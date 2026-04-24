import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { buildZenmuxImageGenerationProvider } from "./image-generation-provider.js";

export default definePluginEntry({
  id: "zenmux",
  name: "ZenMux Provider",
  description: "Bundled ZenMux image generation provider",
  register(api) {
    api.registerImageGenerationProvider(buildZenmuxImageGenerationProvider());
  },
});
