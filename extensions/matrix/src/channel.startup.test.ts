import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureMatrixSdkInstalled: vi.fn<() => Promise<void>>(async () => {}),
  monitorModuleLoaded: vi.fn(),
  monitorMatrixProvider: vi.fn<() => Promise<void>>(async () => {}),
}));

vi.mock("./matrix/deps.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./matrix/deps.js")>()),
  ensureMatrixSdkInstalled: mocks.ensureMatrixSdkInstalled,
}));

vi.mock("./matrix/monitor/index.js", () => {
  mocks.monitorModuleLoaded();
  return { monitorMatrixProvider: mocks.monitorMatrixProvider };
});

import { matrixPlugin } from "./channel.js";

function buildStartAccountContext() {
  return {
    account: {
      accountId: "default",
      homeserver: "https://matrix.example.test",
      config: {},
    },
    runtime: {},
    channelRuntime: {},
    abortSignal: new AbortController().signal,
    setStatus: vi.fn(),
    log: { info: vi.fn() },
  };
}

describe("matrix channel startup", () => {
  beforeEach(() => {
    mocks.ensureMatrixSdkInstalled.mockReset();
    mocks.ensureMatrixSdkInstalled.mockResolvedValue(undefined);
    mocks.monitorModuleLoaded.mockClear();
    mocks.monitorMatrixProvider.mockReset();
    mocks.monitorMatrixProvider.mockResolvedValue(undefined);
  });

  it("reports missing SDK dependencies before starting the monitor", async () => {
    mocks.ensureMatrixSdkInstalled.mockRejectedValueOnce(
      new Error(
        "Matrix plugin dependencies are missing: matrix-js-sdk. Repair this plugin with `openclaw plugins update matrix` or run `openclaw doctor --fix`.",
      ),
    );

    await expect(
      matrixPlugin.gateway?.startAccount?.(buildStartAccountContext() as never),
    ).rejects.toThrow(/Matrix plugin dependencies are missing/);

    expect(mocks.ensureMatrixSdkInstalled).toHaveBeenCalledOnce();
    expect(mocks.monitorModuleLoaded).not.toHaveBeenCalled();
    expect(mocks.monitorMatrixProvider).not.toHaveBeenCalled();
  });

  it("starts the monitor after SDK dependencies are available", async () => {
    await expect(
      matrixPlugin.gateway?.startAccount?.(buildStartAccountContext() as never),
    ).resolves.toBeUndefined();

    expect(mocks.ensureMatrixSdkInstalled).toHaveBeenCalledOnce();
    expect(mocks.monitorModuleLoaded).toHaveBeenCalledOnce();
    expect(mocks.monitorMatrixProvider).toHaveBeenCalledOnce();
  });
});
