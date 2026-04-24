import { GoogleGenAI } from "@google/genai";
import type { ImageGenerationProvider } from "openclaw/plugin-sdk/image-generation";
import { isProviderApiKeyConfigured } from "openclaw/plugin-sdk/provider-auth";
import { resolveApiKeyForProvider } from "openclaw/plugin-sdk/provider-auth-runtime";
import {
  assertOkOrThrowHttpError,
  postJsonRequest,
  resolveProviderHttpRequestConfig,
} from "openclaw/plugin-sdk/provider-http";

const PROVIDER_ID = "zenmux";
const DEFAULT_ZENMUX_OPENAI_BASE_URL = "https://zenmux.ai/api/v1";
const DEFAULT_ZENMUX_VERTEX_BASE_URL = "https://zenmux.ai/api/vertex-ai";
const DEFAULT_ZENMUX_IMAGE_MODEL = "openai/gpt-image-2";
const SUPPORTED_ZENMUX_IMAGE_MODELS = [
  "openai/gpt-image-2",
  "google/gemini-3.1-flash-image-preview",
] as const;
const DEFAULT_OUTPUT_MIME = "image/png";
const DEFAULT_OPENAI_IMAGE_SIZE = "1024x1024";

export type ZenmuxImageModel = (typeof SUPPORTED_ZENMUX_IMAGE_MODELS)[number];

type ZenmuxOpenAiImageApiResponse = {
  data?: Array<{
    b64_json?: string;
    revised_prompt?: string;
  }>;
};

type ZenmuxGoogleGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        inlineData?: {
          mimeType?: string;
          data?: string;
        };
        inline_data?: {
          mimeType?: string;
          data?: string;
        };
      }>;
    };
  }>;
};

function isSupportedZenmuxImageModel(value: string | undefined): value is ZenmuxImageModel {
  return Boolean(value && SUPPORTED_ZENMUX_IMAGE_MODELS.some((model) => model === value));
}

function normalizeModel(value: string | undefined): ZenmuxImageModel {
  const normalized = value?.trim() || DEFAULT_ZENMUX_IMAGE_MODEL;
  return isSupportedZenmuxImageModel(normalized) ? normalized : DEFAULT_ZENMUX_IMAGE_MODEL;
}

function isGoogleImageModel(model: ZenmuxImageModel): boolean {
  return model.startsWith("google/");
}

function resolveConfiguredBaseUrl(
  cfg: Parameters<ImageGenerationProvider["generateImage"]>[0]["cfg"],
): string | undefined {
  return cfg?.models?.providers?.[PROVIDER_ID]?.baseUrl?.trim() || undefined;
}

function resolveZenmuxOpenAiBaseUrl(
  cfg: Parameters<ImageGenerationProvider["generateImage"]>[0]["cfg"],
): string {
  return resolveConfiguredBaseUrl(cfg) || DEFAULT_ZENMUX_OPENAI_BASE_URL;
}

function resolveZenmuxVertexBaseUrl(
  cfg: Parameters<ImageGenerationProvider["generateImage"]>[0]["cfg"],
): string {
  const configured = resolveConfiguredBaseUrl(cfg);
  if (!configured) {
    return DEFAULT_ZENMUX_VERTEX_BASE_URL;
  }
  return configured
    .replace(/\/api\/v1\/?$/u, "/api/vertex-ai")
    .replace(/\/v1\/?$/u, "/api/vertex-ai");
}

function extractOpenAiImages(payload: ZenmuxOpenAiImageApiResponse) {
  return (payload.data ?? [])
    .map((entry, index) => {
      if (!entry.b64_json) {
        return null;
      }
      return Object.assign(
        {
          buffer: Buffer.from(entry.b64_json, "base64"),
          mimeType: DEFAULT_OUTPUT_MIME,
          fileName: `image-${index + 1}.png`,
        },
        entry.revised_prompt ? { revisedPrompt: entry.revised_prompt } : {},
      );
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

function extractGoogleImages(payload: ZenmuxGoogleGenerateContentResponse) {
  const images = [] as Array<{
    buffer: Buffer;
    mimeType: string;
    fileName: string;
  }>;
  for (const candidate of payload.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      const inline = part.inlineData ?? part.inline_data;
      const data = inline?.data?.trim();
      if (!data) {
        continue;
      }
      images.push({
        buffer: Buffer.from(data, "base64"),
        mimeType: inline?.mimeType?.trim() || DEFAULT_OUTPUT_MIME,
        fileName: `image-${images.length + 1}.png`,
      });
    }
  }
  return images;
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
      const requestedModel = req.model?.trim();
      if (requestedModel && !isSupportedZenmuxImageModel(requestedModel)) {
        throw new Error(
          `ZenMux image generation currently supports only ${SUPPORTED_ZENMUX_IMAGE_MODELS.join(" and ")} models.`,
        );
      }
      const model = normalizeModel(requestedModel);

      const auth = await resolveApiKeyForProvider({
        provider: PROVIDER_ID,
        cfg: req.cfg,
        agentDir: req.agentDir,
        store: req.authStore,
      });
      if (!auth.apiKey) {
        throw new Error("ZenMux API key missing");
      }

      if (isGoogleImageModel(model)) {
        const client = new GoogleGenAI({
          apiKey: auth.apiKey,
          vertexai: true,
          httpOptions: {
            apiVersion: "v1",
            baseUrl: resolveZenmuxVertexBaseUrl(req.cfg),
            timeout: req.timeoutMs,
          },
        });
        const payload = (await client.models.generateContent({
          model,
          contents: [{ text: req.prompt }],
          config: {
            responseModalities: ["TEXT", "IMAGE"],
          },
        })) as ZenmuxGoogleGenerateContentResponse;
        const images = extractGoogleImages(payload);
        if (images.length === 0) {
          throw new Error("ZenMux image generation returned no images");
        }
        return {
          images,
          model,
        };
      }

      const { baseUrl, allowPrivateNetwork, headers, dispatcherPolicy } =
        resolveProviderHttpRequestConfig({
          baseUrl: resolveZenmuxOpenAiBaseUrl(req.cfg),
          defaultBaseUrl: DEFAULT_ZENMUX_OPENAI_BASE_URL,
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
          size: DEFAULT_OPENAI_IMAGE_SIZE,
        },
        timeoutMs: req.timeoutMs,
        fetchFn: fetch,
        allowPrivateNetwork,
        dispatcherPolicy,
      });
      try {
        await assertOkOrThrowHttpError(response, `ZenMux image generation failed`);

        const payload = (await response.json()) as ZenmuxOpenAiImageApiResponse;
        const images = extractOpenAiImages(payload);

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
