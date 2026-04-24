import * as providerAuthRuntime from "openclaw/plugin-sdk/provider-auth-runtime";
import * as providerHttp from "openclaw/plugin-sdk/provider-http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildZenmuxImageGenerationProvider } from "./image-generation-provider.js";

describe("ZenMux image-generation provider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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

  it("forwards nested zenmux model refs to the OpenAI-compatible image endpoint", async () => {
    vi.spyOn(providerAuthRuntime, "resolveApiKeyForProvider").mockResolvedValue({
      apiKey: "zenmux-secret-key",
    });

    const postJsonRequestSpy = vi.spyOn(providerHttp, "postJsonRequest");
    postJsonRequestSpy.mockResolvedValueOnce({
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
              baseUrl: "https://proxy.local/v1",
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
        url: "https://proxy.local/v1/images/generations",
        body: {
          model: "openai/gpt-image-2",
          prompt: "a robot on a cliff",
          n: 1,
        },
      }),
    );
    expect(result.images).toHaveLength(1);
    expect(result.model).toBe("openai/gpt-image-2");
  });

  it("rejects unsupported zenmux image models with a clear message", async () => {
    vi.spyOn(providerAuthRuntime, "resolveApiKeyForProvider").mockResolvedValue({
      apiKey: "zenmux-secret-key",
    });

    const provider = buildZenmuxImageGenerationProvider();
    await expect(
      provider.generateImage({
        provider: "zenmux",
        model: "unsupported/model",
        prompt: "a robot on a cliff",
      }),
    ).rejects.toThrow(
      "ZenMux image generation currently supports only openai/gpt-image-2 and google/gemini-3.1-flash-image-preview models.",
    );
  });
});
