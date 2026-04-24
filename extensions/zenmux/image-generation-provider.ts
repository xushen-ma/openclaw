import type { ImageGenerationProvider } from "openclaw/plugin-sdk/image-generation";
import { isProviderApiKeyConfigured } from "openclaw/plugin-sdk/provider-auth";
import { resolveApiKeyForProvider } from "openclaw/plugin-sdk/provider-auth-runtime";
import {
  assertOkOrThrowHttpError,
  postJsonRequest,
  resolveProviderHttpRequestConfig,
} from "openclaw/plugin-sdk/provider-http";

const PROVIDER_ID = "zenmux";
const DEFAULT_ZENMUX_IMAGE_BASE_URL = "https://api.zenmux.ai/v1";
const DEFAULT_ZENMUX_IMAGE_MODEL = "openai/gpt-image-2";
const SUPPORTED_ZENMUX_IMAGE_MODELS = [
  "openai/gpt-image-2",
  "google/gemini-3.1-flash-image-preview",
] as const;
const DEFAULT_OUTPUT_MIME = "image/png";

export type ZenmuxImageModel = (typeof SUPPORTED_ZENMUX_IMAGE_MODELS)[number];

type ZenmuxImageApiResponse = {
  data?: Array<{
    b64_json?: string;
    revised_prompt?: string;
  }>;
};

function isSupportedZenmuxImageModel(value: string | undefined): value is ZenmuxImageModel {
  return Boolean(value && SUPPORTED_ZENMUX_IMAGE_MODELS.includes(value));
}

function normalizeModel(value: string | undefined): string {
  return value?.trim() || DEFAULT_ZENMUX_IMAGE_MODEL;
}

export function buildZenmuxImageGenerationProvider(): ImageGenerationProvider {
  return {
    id: PROVIDER_ID,
    label: "ZenMux",
    defaultModel: DEFAULT_ZENMUX_IMAGE_MODEL,
    models: [...SUPPORTED_ZENMUX_IMAGE_MODELS],
    isConfigured: ({ agentDir }) =>
      isProviderApiKeyConfigured({
        provider: PROVIDER_ID,
        agentDir,
      }),
    capabilities: {
      generate: {
        maxCount: 4,
        supportsSize: false,
        supportsAspectRatio: false,
        supportsResolution: false,
      },
      edit: {
        enabled: false,
        maxCount: 0,
        maxInputImages: 0,
        supportsSize: false,
        supportsAspectRatio: false,
        supportsResolution: false,
      },
      geometry: {
        sizes: [],
      },
    },
    async generateImage(req) {
      const model = normalizeModel(req.model);
      if (!isSupportedZenmuxImageModel(model)) {
        throw new Error(
          `ZenMux image generation currently supports only ${SUPPORTED_ZENMUX_IMAGE_MODELS.join(" and ")} models.`,
        );
      }

      const auth = await resolveApiKeyForProvider({
        provider: PROVIDER_ID,
        cfg: req.cfg,
        agentDir: req.agentDir,
        store: req.authStore,
      });
      if (!auth.apiKey) {
        throw new Error("ZenMux API key missing");
      }

      const { baseUrl, allowPrivateNetwork, headers, dispatcherPolicy } =
        resolveProviderHttpRequestConfig({
          baseUrl: req.cfg?.models?.providers?.[PROVIDER_ID]?.baseUrl,
          defaultBaseUrl: DEFAULT_ZENMUX_IMAGE_BASE_URL,
          allowPrivateNetwork: false,
          defaultHeaders: {
            Authorization: `Bearer ${auth.apiKey}`,
            "Content-Type": "application/json",
          },
          provider: PROVIDER_ID,
          capability: "image",
          transport: "http",
        });

      const { response, release } = await postJsonRequest({
        url: `${baseUrl}/images/generations`,
        headers,
        body: {
          model,
          prompt: req.prompt,
          n: req.count ?? 1,
        },
        timeoutMs: req.timeoutMs,
        fetchFn: fetch,
        allowPrivateNetwork,
        dispatcherPolicy,
      });
      try {
        await assertOkOrThrowHttpError(response, `ZenMux image generation failed`);

        const payload = (await response.json()) as ZenmuxImageApiResponse;
        const images = (payload.data ?? [])
          .map((entry, index) => {
            if (!entry.b64_json) {
              return null;
            }
            return Object.assign(
              {
                buffer: Buffer.from(entry.b64_json, `base64`),
                mimeType: DEFAULT_OUTPUT_MIME,
                fileName: `image-${index + 1}.png`,
              },
              entry.revised_prompt ? { revisedPrompt: entry.revised_prompt } : {},
            );
          })
          .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

        if (images.length === 0) {
          throw new Error("ZenMux image generation returned no images");
        }

        return {
          images,
          model,
        };
      } finally {
        await release();
      }
    },
  };
}
