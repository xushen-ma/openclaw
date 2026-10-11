import { afterEach, describe, expect, it, vi } from "vitest";
import { AsyncWorkScope, getAsyncWorkSignal } from "../shared/async-work-scope.js";
import {
  formatStatusDiagnostic,
  markStatusPhase,
  observeStatusOwner,
  observeStatusSession,
  withStatusDiagnostics,
} from "./status-diagnostics.js";

function fact(error = new Error("private credential must not appear")) {
  return JSON.parse(formatStatusDiagnostic(error).split(" statusDiagnostic=")[1]!);
}
afterEach(() => vi.unstubAllEnvs());
describe("status diagnostic observation", () => {
  it("is disabled by default", () => {
    vi.stubEnv("OPENCLAW_STATUS_DIAGNOSTICS", "");
    expect(withStatusDiagnostics(() => formatStatusDiagnostic(new Error("private")))).toBe("");
  });
  it("bounds stack/cause output and omits messages, paths and cyclic objects", () => {
    vi.stubEnv("OPENCLAW_STATUS_DIAGNOSTICS", "1");
    const error = new Error("private");
    error.stack =
      "Error: private\n" +
      "    at privateFunction (/private/home/status-text.ts:484:10)\n".repeat(40);
    error.cause = error;
    withStatusDiagnostics(() => {
      const result = fact(error);
      expect(result.errors).toEqual([
        { kind: "Error", frames: Array(6).fill("status-text.ts:484:10") },
      ]);
      expect(JSON.stringify(result)).not.toContain("private");
      expect(JSON.stringify(result).length).toBeLessThan(2000);
    });
  });
  it("excludes multiline messages even when they imitate stack frames", () => {
    vi.stubEnv("OPENCLAW_STATUS_DIAGNOSTICS", "1");
    const error = new Error("private\n    at /private/token-SECRET.ts:123:45");
    withStatusDiagnostics(() => {
      expect(formatStatusDiagnostic(error)).not.toContain("SECRET");
      expect(formatStatusDiagnostic(error)).not.toContain("private");
    });
  });
  it("still invokes the operation with a hostile cancellation reason", () => {
    vi.stubEnv("OPENCLAW_STATUS_DIAGNOSTICS", "1");
    const reason = new Error("private");
    Object.defineProperty(reason, "name", {
      get() {
        throw new Error("private getter");
      },
    });
    const work = new AsyncWorkScope();
    work.beginClose(reason);
    const run = vi.fn(() => 42);
    expect(work.run(() => withStatusDiagnostics(run))).toBe(42);
    expect(run).toHaveBeenCalledOnce();
    expect(work.signal.reason).toBe(reason);
  });

  it("does not inspect a hostile cancellation reason outside the observation guard", () => {
    vi.stubEnv("OPENCLAW_STATUS_DIAGNOSTICS", "1");
    const reason = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("prototype trap");
        },
      },
    );
    const work = new AsyncWorkScope();
    work.beginClose(reason);
    const run = vi.fn(() => 42);
    expect(work.run(() => withStatusDiagnostics(run))).toBe(42);
    expect(run).toHaveBeenCalledOnce();
    expect(work.signal.reason).toBe(reason);
  });

  it("keeps eight concurrent targets and replaced owners isolated", async () => {
    vi.stubEnv("OPENCLAW_STATUS_DIAGNOSTICS", "1");
    const results = await Promise.all(
      ["mini", "ben", "kiki", "janko", "pollen", "coco", "uri", "mira"].map((agent, index) =>
        withStatusDiagnostics(async () => {
          observeStatusSession("agent:" + agent + ":main");
          let current = true;
          observeStatusOwner({ isCurrent: () => current });
          await Promise.resolve();
          current = index % 2 === 0;
          markStatusPhase("subagents");
          return fact();
        }),
      ),
    );
    expect(new Set(results.map((result) => result.correlation)).size).toBe(8);
    expect(results.map((result) => result.owner)).toEqual([
      "current",
      "replaced",
      "current",
      "replaced",
      "current",
      "replaced",
      "current",
      "replaced",
    ]);
    expect(formatStatusDiagnostic(new Error())).toBe("");
  });
  it("preserves request cancellation and shutdown without replacing the work owner", async () => {
    vi.stubEnv("OPENCLAW_STATUS_DIAGNOSTICS", "1");
    const work = new AsyncWorkScope();
    const reason = new DOMException("private shutdown reason", "AbortError");
    await work.track(() =>
      withStatusDiagnostics(async () => {
        expect(getAsyncWorkSignal()).toBe(work.signal);
        work.beginClose(reason);
        await Promise.resolve();
        expect(() => getAsyncWorkSignal()?.throwIfAborted()).toThrow(reason);
        expect(fact(reason)).toMatchObject({
          entrySignal: { aborted: false },
          signal: { aborted: true, reason: "AbortError" },
        });
      }),
    );
    await work.drain();
  });
});
