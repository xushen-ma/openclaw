import { describe, expect, it, vi } from "vitest";
import type { SessionEntry } from "../../config/sessions.js";

const mocks = vi.hoisted(() => {
  const hookEvent = { messages: [] as string[] };
  return {
    hookEvent,
    triggerInternalHook: vi.fn(async () => undefined),
    createInternalHookEvent: vi.fn(() => hookEvent),
    runBeforeReset: vi.fn(async () => undefined),
    hasHooks: vi.fn(() => true),
    readFile: vi.fn(async () => ""),
  };
});

vi.mock("node:fs/promises", () => ({
  default: {
    readFile: mocks.readFile,
  },
}));

vi.mock("../../hooks/internal-hooks.js", () => ({
  createInternalHookEvent: mocks.createInternalHookEvent,
  triggerInternalHook: mocks.triggerInternalHook,
}));

vi.mock("../../plugins/hook-runner-global.js", () => ({
  getGlobalHookRunner: () => ({
    hasHooks: mocks.hasHooks,
    runBeforeReset: mocks.runBeforeReset,
  }),
}));

vi.mock("../../globals.js", () => ({
  logVerbose: vi.fn(),
}));

const { emitResetCommandHooks, DEFAULT_SMART_RESET_REVIEW_PROMPT } =
  await import("./commands-core.js");

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeParams(cfg: Record<string, unknown>) {
  const entry: SessionEntry = {
    sessionId: "s1",
    updatedAt: Date.now(),
  };
  return {
    action: "new" as const,
    ctx: {},
    cfg,
    command: {
      surface: "native",
      senderId: "u1",
      channel: "discord",
      from: "u1",
      to: "c1",
      resetHookTriggered: false,
    },
    sessionKey: "agent:main:discord:direct:u1",
    sessionEntry: entry,
    previousSessionEntry: entry,
    workspaceDir: "/tmp/workspace",
  };
}

describe("emitResetCommandHooks smart reset", () => {
  it("keeps default behavior unchanged when smart reset is disabled", async () => {
    const waitForHook = deferred<undefined>();
    mocks.runBeforeReset.mockImplementationOnce(() => waitForHook.promise);

    await emitResetCommandHooks(makeParams({ session: {} }));

    expect(mocks.runBeforeReset).toHaveBeenCalledWith(
      expect.objectContaining({ reviewPrompt: undefined }),
      expect.anything(),
    );
    waitForHook.resolve(undefined);
  });

  it("invokes smart mode with default prompt when enabled", async () => {
    await emitResetCommandHooks(makeParams({ session: { smartReset: { enabled: true } } }));

    expect(mocks.runBeforeReset).toHaveBeenLastCalledWith(
      expect.objectContaining({ reviewPrompt: DEFAULT_SMART_RESET_REVIEW_PROMPT }),
      expect.anything(),
    );
  });

  it("uses configurable prompt override", async () => {
    await emitResetCommandHooks(
      makeParams({ session: { smartReset: { enabled: true, prompt: "save key decisions" } } }),
    );

    expect(mocks.runBeforeReset).toHaveBeenLastCalledWith(
      expect.objectContaining({ reviewPrompt: "save key decisions" }),
      expect.anything(),
    );
  });

  it("wait=true blocks until review completion", async () => {
    let finished = false;
    const waitForHook = deferred<undefined>();
    mocks.runBeforeReset.mockImplementationOnce(async () => {
      await waitForHook.promise;
      finished = true;
    });

    const run = emitResetCommandHooks(
      makeParams({ session: { smartReset: { enabled: true, wait: true } } }),
    );

    await Promise.resolve();
    expect(finished).toBe(false);
    waitForHook.resolve(undefined);
    await run;
    expect(finished).toBe(true);
  });

  it("wait=false is fire-and-forget", async () => {
    const waitForHook = deferred<undefined>();
    let finished = false;
    mocks.runBeforeReset.mockImplementationOnce(async () => {
      await waitForHook.promise;
      finished = true;
    });

    await emitResetCommandHooks(
      makeParams({ session: { smartReset: { enabled: true, wait: false } } }),
    );

    expect(finished).toBe(false);
    waitForHook.resolve(undefined);
    await Promise.resolve();
  });
});
