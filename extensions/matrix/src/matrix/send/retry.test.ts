import { beforeEach, describe, expect, it, vi } from "vitest";
import { withRetryOnRateLimit } from "./retry.js";

describe("withRetryOnRateLimit", () => {
  let mockDelayFn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockDelayFn = vi.fn().mockResolvedValue(undefined);
  });

  it("returns result on first success", async () => {
    const fn = vi.fn().mockResolvedValue("success");

    const result = await withRetryOnRateLimit(fn, { delayFn: mockDelayFn });

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(mockDelayFn).not.toHaveBeenCalled();
  });

  it("retries on M_LIMIT_EXCEEDED with errcode", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ errcode: "M_LIMIT_EXCEEDED", retryAfterMs: 1000 })
      .mockResolvedValueOnce("success");

    const result = await withRetryOnRateLimit(fn, { delayFn: mockDelayFn });

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(mockDelayFn).toHaveBeenCalledTimes(1);
    // Should have jitter, so should be between 1000 and 1100
    const delayMs = mockDelayFn.mock.calls[0][0];
    expect(delayMs).toBeGreaterThanOrEqual(1000);
    expect(delayMs).toBeLessThan(1100);
  });

  it("retries on statusCode 429", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ statusCode: 429, retry_after_ms: 500 })
      .mockResolvedValueOnce("success");

    const result = await withRetryOnRateLimit(fn, { delayFn: mockDelayFn });

    expect(result).toBe("success");
    expect(fn).toHaveBeenCalledTimes(2);
    expect(mockDelayFn).toHaveBeenCalledTimes(1);
    const delayMs = mockDelayFn.mock.calls[0][0];
    expect(delayMs).toBeGreaterThanOrEqual(500);
    expect(delayMs).toBeLessThan(600);
  });

  it("uses default 1000ms when retryAfterMs is missing", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ errcode: "M_LIMIT_EXCEEDED" })
      .mockResolvedValueOnce("success");

    const result = await withRetryOnRateLimit(fn, { delayFn: mockDelayFn });

    expect(result).toBe("success");
    const delayMs = mockDelayFn.mock.calls[0][0];
    expect(delayMs).toBeGreaterThanOrEqual(1000);
    expect(delayMs).toBeLessThan(1100);
  });

  it("does not retry on non-rate-limit errors", async () => {
    const fn = vi.fn().mockRejectedValue({ errcode: "M_FORBIDDEN", statusCode: 403 });

    await expect(withRetryOnRateLimit(fn, { delayFn: mockDelayFn })).rejects.toMatchObject({
      errcode: "M_FORBIDDEN",
    });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(mockDelayFn).not.toHaveBeenCalled();
  });

  it("does not retry on M_NOT_FOUND", async () => {
    const fn = vi.fn().mockRejectedValue({ errcode: "M_NOT_FOUND", statusCode: 404 });

    await expect(withRetryOnRateLimit(fn, { delayFn: mockDelayFn })).rejects.toMatchObject({
      errcode: "M_NOT_FOUND",
    });

    expect(fn).toHaveBeenCalledTimes(1);
    expect(mockDelayFn).not.toHaveBeenCalled();
  });

  it("throws after max retries exceeded (default 5)", async () => {
    const fn = vi.fn().mockRejectedValue({ errcode: "M_LIMIT_EXCEEDED", retryAfterMs: 100 });

    await expect(withRetryOnRateLimit(fn, { delayFn: mockDelayFn })).rejects.toMatchObject({
      errcode: "M_LIMIT_EXCEEDED",
    });

    expect(fn).toHaveBeenCalledTimes(6); // 1 initial + 5 retries
    expect(mockDelayFn).toHaveBeenCalledTimes(5);
  });

  it("respects custom maxRetries", async () => {
    const fn = vi.fn().mockRejectedValue({ errcode: "M_LIMIT_EXCEEDED", retryAfterMs: 100 });

    await expect(
      withRetryOnRateLimit(fn, { maxRetries: 2, delayFn: mockDelayFn }),
    ).rejects.toMatchObject({
      errcode: "M_LIMIT_EXCEEDED",
    });

    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    expect(mockDelayFn).toHaveBeenCalledTimes(2);
  });

  it("aborts when maxTotalWaitMs would be exceeded", async () => {
    const fn = vi.fn().mockRejectedValue({ errcode: "M_LIMIT_EXCEEDED", retryAfterMs: 10_000 });

    await expect(
      withRetryOnRateLimit(fn, { maxTotalWaitMs: 15_000, delayFn: mockDelayFn }),
    ).rejects.toMatchObject({
      errcode: "M_LIMIT_EXCEEDED",
    });

    // Should only retry once: first delay ~10s, second would exceed 15s total
    expect(fn).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
    expect(mockDelayFn).toHaveBeenCalledTimes(1);
  });

  it("does not cause duplicate delivery on success", async () => {
    let callCount = 0;
    const fn = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw { errcode: "M_LIMIT_EXCEEDED", retryAfterMs: 100 };
      }
      return "delivered";
    });

    const result = await withRetryOnRateLimit(fn, { delayFn: mockDelayFn });

    expect(result).toBe("delivered");
    expect(fn).toHaveBeenCalledTimes(2); // Only 2 calls: fail, then success
    expect(mockDelayFn).toHaveBeenCalledTimes(1);
  });

  it("retries multiple times before success", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ errcode: "M_LIMIT_EXCEEDED", retryAfterMs: 100 })
      .mockRejectedValueOnce({ statusCode: 429, retry_after_ms: 200 })
      .mockRejectedValueOnce({ errcode: "M_LIMIT_EXCEEDED", retryAfterMs: 150 })
      .mockResolvedValueOnce("finally");

    const result = await withRetryOnRateLimit(fn, { delayFn: mockDelayFn });

    expect(result).toBe("finally");
    expect(fn).toHaveBeenCalledTimes(4);
    expect(mockDelayFn).toHaveBeenCalledTimes(3);
  });

  it("handles errors without retryAfterMs gracefully", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce({ statusCode: 429 }) // No retry_after_ms
      .mockResolvedValueOnce("ok");

    const result = await withRetryOnRateLimit(fn, { delayFn: mockDelayFn });

    expect(result).toBe("ok");
    expect(mockDelayFn).toHaveBeenCalledTimes(1);
    // Should use default 1000ms
    const delayMs = mockDelayFn.mock.calls[0][0];
    expect(delayMs).toBeGreaterThanOrEqual(1000);
  });

  it("preserves original error object on final throw", async () => {
    const originalError = {
      errcode: "M_LIMIT_EXCEEDED",
      retryAfterMs: 100,
      message: "Rate limited",
      statusCode: 429,
    };
    const fn = vi.fn().mockRejectedValue(originalError);

    await expect(withRetryOnRateLimit(fn, { maxRetries: 1, delayFn: mockDelayFn })).rejects.toBe(
      originalError,
    );
  });
});
