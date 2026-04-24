import { GoogleGenAI } from "@google/genai";
import * as providerAuthRuntime from "openclaw/plugin-sdk/provider-auth-runtime";
import * as providerHttp from "openclaw/plugin-sdk/provider-http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildZenmuxImageGenerationProvider } from "./image-generation-provider.js";

vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(),
}));

describe("ZenMux image-generation provider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(GoogleGenAI).mockReset();
  });

  it("registers provider metadata and explicit models", () => {
    const provider = buildZenmuxImageGenerationProvider();
    expect(provider.id).toBe("zenmux");
    expect(provider.label).toBe("ZenMux");
    expect(provider.defaultModel).toBe("openai/gpt-image-2");
    expect(provider.models).toEqual([
      "openai/gpt-image-2",
      "google/gemini-3.1-flash-image-preview",
    ]);
    expect(provider.capabilities.generate.supportsSize).toBe(false);
    expect(provider.capabilities.edit.enabled).toBe(false);
  });

  it("forwards OpenAI image models to the ZenMux OpenAI-compatible image endpoint", async () => {
    vi.spyOn(providerAuthRuntime, "resolveApiKeyForProvider").mockResolvedValue({
      apiKey: "zenmux-secret-key",
      source: "test",
      mode: "api-key",
    });

    const postJsonRequestSpy = vi.spyOn(providerHttp, "postJsonRequest");
    postJsonRequestSpy.mockResolvedValueOnce({
      finalUrl: "https://zenmux.ai/api/v1/images/generations",
      response: new Response(
        JSON.stringify({
          data: [{ b64_json: Buffer.from("bytes").toString("base64") }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      ),
      release: vi.fn(),
    });

    const provider = buildZenmuxImageGenerationProvider();
    const result = await provider.generateImage({
      provider: "zenmux",
      model: "openai/gpt-image-2",
      prompt: "a robot on a cliff",
      cfg: {
        models: {
          providers: {
            zenmux: {
              baseUrl: "https://zenmux.ai/api/v1",
              models: [],
            },
          },
        },
      },
      timeoutMs: 10_000,
      count: 1,
    });

    const request = postJsonRequestSpy.mock.calls[0];
    expect(request?.[0]).toEqual(
      expect.objectContaining({
        url: "https://zenmux.ai/api/v1/images/generations",
        body: {
          model: "openai/gpt-image-2",
          prompt: "a robot on a cliff",
          n: 1,
          size: "1024x1024",
        },
      }),
    );
    expect(result.images).toHaveLength(1);
    expect(result.model).toBe("openai/gpt-image-2");
  });

  it("routes Gemini image models through the Vertex generateContent client", async () => {
    vi.spyOn(providerAuthRuntime, "resolveApiKeyForProvider").mockResolvedValue({
      apiKey: "zenmux-secret-key",
      source: "test",
      mode: "api-key",
    });

    const generateContent = vi.fn().mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  mimeType: "image/png",
                  data: Buffer.from("bytes").toString("base64"),
                },
              },
            ],
          },
        },
      ],
    });
    vi.mocked(GoogleGenAI).mockImplementation(function MockGoogleGenAI() {
      return {
        models: {
          generateContent,
        },
      } as never;
    } as never);

    const provider = buildZenmuxImageGenerationProvider();
    const result = await provider.generateImage({
      provider: "zenmux",
      model: "google/gemini-3.1-flash-image-preview",
      prompt: "a robot on a cliff",
      cfg: {
        models: {
          providers: {
            zenmux: {
              baseUrl: "https://zenmux.ai/api/v1",
              models: [],
            },
          },
        },
      },
      timeoutMs: 10_000,
    });

    expect(GoogleGenAI).toHaveBeenCalledWith({
      apiKey: "zenmux-secret-key",
      vertexai: true,
      httpOptions: {
        apiVersion: "v1",
        baseUrl: "https://zenmux.ai/api/vertex-ai",
        timeout: 10_000,
      },
    });
    expect(generateContent).toHaveBeenCalledWith({
      model: "google/gemini-3.1-flash-image-preview",
      contents: [{ text: "a robot on a cliff" }],
      config: {
        responseModalities: ["TEXT", "IMAGE"],
      },
    });
    expect(result.images).toHaveLength(1);
    expect(result.model).toBe("google/gemini-3.1-flash-image-preview");
  });

  it("rejects unsupported zenmux image models with a clear message", async () => {
    vi.spyOn(providerAuthRuntime, "resolveApiKeyForProvider").mockResolvedValue({
      apiKey: "zenmux-secret-key",
      source: "test",
      mode: "api-key",
    });

    const provider = buildZenmuxImageGenerationProvider();
    await expect(
      provider.generateImage({
        provider: "zenmux",
        model: "unsupported/model",
        prompt: "a robot on a cliff",
        cfg: {},
      }),
    ).rejects.toThrow(
      "ZenMux image generation currently supports only openai/gpt-image-2 and google/gemini-3.1-flash-image-preview models.",
    );
  });
});
