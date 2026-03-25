import type { MatrixClient } from "@vector-im/matrix-bot-sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the entire matrix-bot-sdk
const mockMatrixClient = {
  sendMessage: vi.fn(),
  sendEvent: vi.fn(),
  stop: vi.fn(),
};

vi.mock("@vector-im/matrix-bot-sdk", () => ({
  MatrixClient: vi.fn(() => mockMatrixClient),
}));

// Mock runtime and dependencies
vi.mock("../runtime.js", () => ({
  getMatrixRuntime: () => ({
    config: {
      loadConfig: () => ({}),
    },
    channel: {
      text: {
        resolveMarkdownTableMode: () => "plaintext",
        convertMarkdownTables: (text: string) => text,
        resolveTextChunkLimit: () => 4000,
        resolveChunkMode: () => "markdown",
        chunkMarkdownTextWithMode: (text: string) => [text],
      },
    },
    media: {
      loadWebMedia: vi.fn(),
    },
  }),
}));

vi.mock("./send-queue.js", () => ({
  enqueueSend: vi.fn((roomId: string, fn: () => Promise<unknown>) => fn()),
}));

vi.mock("./send/client.js", () => ({
  resolveMatrixClient: vi.fn(() =>
    Promise.resolve({
      client: mockMatrixClient as unknown as MatrixClient,
      stopOnDone: false,
    }),
  ),
  resolveMediaMaxBytes: () => 10_000_000,
}));

vi.mock("./send/targets.js", () => ({
  resolveMatrixRoomId: vi.fn((client: unknown, to: string) => Promise.resolve(to)),
  normalizeThreadId: (id?: string) => id,
}));

import { sendMessageMatrix, reactMatrixMessage } from "./send.js";

describe("Matrix send with retry on rate limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMatrixClient.sendMessage.mockReset();
    mockMatrixClient.sendEvent.mockReset();
  });

  it("sendMessageMatrix succeeds on first try", async () => {
    mockMatrixClient.sendMessage.mockResolvedValueOnce("$event123");

    const result = await sendMessageMatrix("!room:example", "Hello");

    expect(result.messageId).toBe("$event123");
    expect(mockMatrixClient.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("sendMessageMatrix retries on M_LIMIT_EXCEEDED", async () => {
    mockMatrixClient.sendMessage
      .mockRejectedValueOnce({ errcode: "M_LIMIT_EXCEEDED", retryAfterMs: 10 })
      .mockResolvedValueOnce("$event456");

    const result = await sendMessageMatrix("!room:example", "Hello");

    expect(result.messageId).toBe("$event456");
    expect(mockMatrixClient.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("sendMessageMatrix retries on statusCode 429", async () => {
    mockMatrixClient.sendMessage
      .mockRejectedValueOnce({ statusCode: 429, retry_after_ms: 10 })
      .mockResolvedValueOnce("$event789");

    const result = await sendMessageMatrix("!room:example", "Hello");

    expect(result.messageId).toBe("$event789");
    expect(mockMatrixClient.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("sendMessageMatrix does not retry on M_FORBIDDEN", async () => {
    mockMatrixClient.sendMessage.mockRejectedValue({ errcode: "M_FORBIDDEN", statusCode: 403 });

    await expect(sendMessageMatrix("!room:example", "Hello")).rejects.toMatchObject({
      errcode: "M_FORBIDDEN",
    });

    expect(mockMatrixClient.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("sendMessageMatrix throws after max retries on rate limit", async () => {
    mockMatrixClient.sendMessage.mockRejectedValue({
      errcode: "M_LIMIT_EXCEEDED",
      retryAfterMs: 10,
    });

    await expect(sendMessageMatrix("!room:example", "Hello")).rejects.toMatchObject({
      errcode: "M_LIMIT_EXCEEDED",
    });

    // Should try 6 times: 1 initial + 5 retries
    expect(mockMatrixClient.sendMessage).toHaveBeenCalledTimes(6);
  });

  it("reactMatrixMessage retries on rate limit", async () => {
    mockMatrixClient.sendEvent
      .mockRejectedValueOnce({ statusCode: 429, retry_after_ms: 10 })
      .mockResolvedValueOnce("$reaction123");

    await reactMatrixMessage("!room:example", "$msg", "👍", mockMatrixClient as MatrixClient);

    expect(mockMatrixClient.sendEvent).toHaveBeenCalledTimes(2);
  });

  it("reactMatrixMessage does not retry on non-rate-limit errors", async () => {
    mockMatrixClient.sendEvent.mockRejectedValue({ errcode: "M_NOT_FOUND", statusCode: 404 });

    await expect(
      reactMatrixMessage("!room:example", "$msg", "👍", mockMatrixClient as MatrixClient),
    ).rejects.toMatchObject({
      errcode: "M_NOT_FOUND",
    });

    expect(mockMatrixClient.sendEvent).toHaveBeenCalledTimes(1);
  });

  it("sendMessageMatrix does not duplicate on success after retry", async () => {
    let callCount = 0;
    mockMatrixClient.sendMessage.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw { errcode: "M_LIMIT_EXCEEDED", retryAfterMs: 10 };
      }
      return "$delivered";
    });

    const result = await sendMessageMatrix("!room:example", "Test");

    expect(result.messageId).toBe("$delivered");
    expect(mockMatrixClient.sendMessage).toHaveBeenCalledTimes(2);
    // Verify only one successful delivery
    expect(callCount).toBe(2);
  });
});
