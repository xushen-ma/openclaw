import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

import { createQuickMemoryPerAgentSidecarService } from "./per-agent-sidecar-service.js";

class MockChild extends EventEmitter {
  pid = 1234;
  exitCode: number | null = null;
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  kill = vi.fn((signal?: NodeJS.Signals) => {
    this.exitCode = signal === "SIGKILL" ? 137 : 0;
    this.emit("exit", this.exitCode, signal ?? null);
    return true;
  });
}

describe("quick-memory per-agent sidecar service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts a managed local sidecar and exposes running status", async () => {
    const child = new MockChild();
    spawnMock.mockReturnValue(child);

    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const sidecar = createQuickMemoryPerAgentSidecarService({
      perAgentBaseUrl: "http://127.0.0.1:8091",
      scriptPath: "/tmp/per-agent-ov-http-server.mjs",
      logger,
    });

    await sidecar.service.start({} as never);

    expect(spawnMock).toHaveBeenCalledWith(
      process.execPath,
      ["/tmp/per-agent-ov-http-server.mjs"],
      expect.objectContaining({
        stdio: ["ignore", "pipe", "pipe"],
        env: expect.objectContaining({
          OV_PER_AGENT_HTTP_HOST: "127.0.0.1",
          OV_PER_AGENT_HTTP_PORT: "8091",
        }),
      }),
    );

    expect(sidecar.status()).toEqual(
      expect.objectContaining({
        enabled: true,
        managed: true,
        running: true,
        baseUrl: "http://127.0.0.1:8091",
        host: "127.0.0.1",
        port: 8091,
        pid: 1234,
      }),
    );

    await sidecar.service.stop?.({} as never);
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("does not manage remote per-agent endpoints", async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const sidecar = createQuickMemoryPerAgentSidecarService({
      perAgentBaseUrl: "http://10.0.0.8:8091",
      scriptPath: "/tmp/per-agent-ov-http-server.mjs",
      logger,
    });

    await sidecar.service.start({} as never);

    expect(spawnMock).not.toHaveBeenCalled();
    expect(sidecar.status()).toEqual(
      expect.objectContaining({
        enabled: true,
        managed: false,
        running: false,
        reason: expect.stringContaining("not local"),
      }),
    );
  });
});
