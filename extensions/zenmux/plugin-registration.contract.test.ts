import { describePluginRegistrationContract } from "openclaw/plugin-sdk/plugin-test-contracts";

describePluginRegistrationContract({
  pluginId: "zenmux",
  imageGenerationProviderIds: ["zenmux"],
  requireGenerateImage: true,
});
