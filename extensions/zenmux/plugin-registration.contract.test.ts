import { describePluginRegistrationContract } from "../../test/helpers/plugins/plugin-registration-contract.js";

describePluginRegistrationContract({
  pluginId: "zenmux",
  imageGenerationProviderIds: ["zenmux"],
  requireGenerateImage: true,
});
