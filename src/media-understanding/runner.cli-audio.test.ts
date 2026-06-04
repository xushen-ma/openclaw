import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/types.js";
import { withAudioFixture } from "./runner.test-utils.js";

const runExecMock = vi.hoisted(() => vi.fn());

vi.mock("../process/exec.js", () => ({
  runExec: (...args: unknown[]) => runExecMock(...args),
}));

let runCliEntry: typeof import("./runner.entries.js").runCliEntry;

describe("media-understanding CLI audio entry", () => {
  beforeAll(async () => {
    ({ runCliEntry } = await import("./runner.entries.js"));
  });

  beforeEach(() => {
    runExecMock.mockReset().mockResolvedValue({ stdout: "cli transcript" });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("applies per-request prompt and language overrides to CLI transcription templating", async () => {
    await withAudioFixture("openclaw-cli-audio", async ({ ctx, cache }) => {
      await runCliEntry({
        capability: "audio",
        entry: {
          type: "cli",
          command: "mock-transcriber",
          args: ["--prompt", "{{Prompt}}", "--language", "{{Language}}", "--file", "{{MediaPath}}"],
          prompt: "entry prompt",
          language: "de",
        },
        cfg: {
          tools: {
            media: {
              audio: {
                prompt: "configured prompt",
                language: "fr",
                _requestPromptOverride: "Focus on names",
                _requestLanguageOverride: "en",
              },
            },
          },
        } as OpenClawConfig,
        ctx,
        attachmentIndex: 0,
        cache,
        config: {
          prompt: "configured prompt",
          language: "fr",
          _requestPromptOverride: "Focus on names",
          _requestLanguageOverride: "en",
        } as never,
      });
    });

    expect(runExecMock).toHaveBeenCalledWith(
      "mock-transcriber",
      expect.arrayContaining(["--prompt", "Focus on names", "--language", "en"]),
      expect.any(Object),
    );
  });

  it("adds a stable model cache directory for configured whisper CLI entries", async () => {
    const previousModelDir = process.env.OPENCLAW_WHISPER_MODEL_DIR;
    process.env.OPENCLAW_WHISPER_MODEL_DIR = "/tmp/openclaw-whisper-models";
    try {
      await withAudioFixture("openclaw-cli-audio", async ({ ctx, cache }) => {
        await runCliEntry({
          capability: "audio",
          entry: {
            type: "cli",
            command: "whisper",
            args: ["--model", "turbo", "{{MediaPath}}"],
          },
          cfg: {
            tools: {
              media: {
                audio: {
                  enabled: true,
                },
              },
            },
          } as OpenClawConfig,
          ctx,
          attachmentIndex: 0,
          cache,
          config: { enabled: true } as never,
        });
      });
    } finally {
      if (previousModelDir === undefined) {
        delete process.env.OPENCLAW_WHISPER_MODEL_DIR;
      } else {
        process.env.OPENCLAW_WHISPER_MODEL_DIR = previousModelDir;
      }
    }

    expect(runExecMock).toHaveBeenCalledWith(
      "whisper",
      expect.arrayContaining(["--model_dir", "/tmp/openclaw-whisper-models"]),
      expect.any(Object),
    );
  });
});
