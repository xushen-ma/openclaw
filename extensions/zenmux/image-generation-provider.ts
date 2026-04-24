import { GoogleGenAI } from "@google/genai";
import type { ImageGenerationProvider } from "openclaw/plugin-sdk/image-generation";
import { isProviderApiKeyConfigured } from "openclaw/plugin-sdk/provider-auth";
import { resolveApiKeyForProvider } from "openclaw/plugin-sdk/provider-auth-runtime";

const PROVIDER_ID = "zenmux";
const DEFAULT_ZENMUX_VERTEX_BASE_URL = "https://zenmux.ai/api/vertex-ai";
const DEFAULT_ZENMUX_IMAGE_MODEL = "google/gemini-3.1-flash-image-preview";
const LEGACY_OPENAI_IMAGE_MODEL = "openai/gpt-image-2";
const SUPPORTED_ZENMUX_IMAGE_MODELS = [DEFAULT_ZENMUX_IMAGE_MODEL] as const;
const DEFAULT_OUTPUT_MIME = "image/png";

export type ZenmuxImageModel = (typeof SUPPORTED_ZENMUX_IMAGE_MODELS)[number];

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

function resolveConfiguredBaseUrl(
  cfg: Parameters<ImageGenerationProvider["generateImage"]>[0]["cfg"],
): string | undefined {
  return cfg?.models?.providers?.[PROVIDER_ID]?.baseUrl?.trim() || undefined;
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
      if (requestedModel === LEGACY_OPENAI_IMAGE_MODEL) {
        throw new Error(
          `ZenMux currently blocks server-side image generation for ${LEGACY_OPENAI_IMAGE_MODEL} with a CSRF token requirement; use ${DEFAULT_ZENMUX_IMAGE_MODEL} instead.`,
        );
      }
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
    },
  };
}
