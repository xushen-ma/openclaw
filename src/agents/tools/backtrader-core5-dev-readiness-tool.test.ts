// Backtrader Core5 readiness tool tests cover the fixed executable boundary
// and its read-only/no-trading process contract.
import { describe, expect, it, vi } from "vitest";
import {
  BACKTRADER_CORE5_DEV_READINESS_SCRIPT,
  BACKTRADER_CORE5_DEV_READINESS_TOOL_NAME,
  createBacktraderCore5DevReadinessTool,
} from "./backtrader-core5-dev-readiness-tool.js";

function readSchemaProperty(schema: unknown, key: string): Record<string, unknown> {
  const root = schema as { properties?: Record<string, unknown> };
  const property = root.properties?.[key];
  if (property === undefined) {
    throw new Error(`expected schema property ${key}`);
  }
  return property as Record<string, unknown>;
}

describe("createBacktraderCore5DevReadinessTool", () => {
  it("publishes only bounded report and timeout inputs", () => {
    const tool = createBacktraderCore5DevReadinessTool();
    const schema = tool.parameters as Record<string, unknown>;
    const report = readSchemaProperty(schema, "report");
    const timeoutMs = readSchemaProperty(schema, "timeoutMs");

    expect(tool.name).toBe(BACKTRADER_CORE5_DEV_READINESS_TOOL_NAME);
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties as Record<string, unknown>)).toEqual([
      "report",
      "timeoutMs",
    ]);
    expect(report).toMatchObject({
      type: "string",
      enum: ["status", "ny-preopen", "daily-paper"],
    });
    expect(report).not.toHaveProperty("anyOf");
    expect(timeoutMs).toMatchObject({ type: "integer", minimum: 1, maximum: 600_000 });
  });

  it("runs only the fixed readiness executable with safety flags", async () => {
    const runFile = vi.fn(async () => ({ stdout: '{"ready":true}\n', stderr: "" }));
    const tool = createBacktraderCore5DevReadinessTool({ runFile });
    const controller = new AbortController();

    const result = await tool.execute(
      "call-1",
      {
        report: "daily-paper",
        timeoutMs: 900_000,
        command: "submit-order",
        path: "/tmp/not-allowed",
        arm: true,
      },
      controller.signal,
    );

    expect(runFile).toHaveBeenCalledOnce();
    expect(runFile).toHaveBeenCalledWith(
      BACKTRADER_CORE5_DEV_READINESS_SCRIPT,
      ["--report", "daily-paper", "--json"],
      expect.objectContaining({
        cwd: "/Users/openclaw/.openclaw/workspace-uri/projects/backtrader-dev",
        timeout: 600_000,
        signal: controller.signal,
        windowsHide: true,
        shell: false,
        maxBuffer: 2 * 1024 * 1024,
        env: expect.objectContaining({
          OPENCLAW_BACKTRADER_CORE5_DEV_READINESS: "1",
          OPENCLAW_BACKTRADER_CORE5_READ_ONLY: "1",
          OPENCLAW_BACKTRADER_CORE5_NO_SUBMIT: "1",
          OPENCLAW_BACKTRADER_CORE5_NO_ARM: "1",
        }),
      }),
    );
    expect(result.details).toMatchObject({
      ok: true,
      report: "daily-paper",
      script: BACKTRADER_CORE5_DEV_READINESS_SCRIPT,
      stdout: { ready: true },
    });
  });

  it("defaults to the status report and a two-minute timeout", async () => {
    const runFile = vi.fn(async () => ({ stdout: "plain status\n", stderr: "warning\n" }));
    const tool = createBacktraderCore5DevReadinessTool({ runFile });

    const result = await tool.execute("call-1", {});

    expect(runFile).toHaveBeenCalledWith(
      BACKTRADER_CORE5_DEV_READINESS_SCRIPT,
      ["--report", "status", "--json"],
      expect.objectContaining({ timeout: 120_000 }),
    );
    expect(result.details).toMatchObject({
      ok: true,
      report: "status",
      stdout: "plain status",
      stderr: "warning",
    });
  });

  it("rejects unsupported reports and non-positive timeouts before execution", async () => {
    const runFile = vi.fn(async () => ({ stdout: "", stderr: "" }));
    const tool = createBacktraderCore5DevReadinessTool({ runFile });

    await expect(tool.execute("call-1", { report: "submit" })).rejects.toThrow(
      "report must be status, ny-preopen, or daily-paper",
    );
    await expect(tool.execute("call-2", { timeoutMs: 0 })).rejects.toThrow(
      "timeoutMs must be a positive finite number",
    );
    expect(runFile).not.toHaveBeenCalled();
  });

  it("returns bounded subprocess diagnostics without throwing", async () => {
    const failure = Object.assign(new Error("readiness failed"), {
      code: "EFAIL",
      signal: "SIGTERM",
      killed: true,
      stdout: '{"ready":false}',
      stderr: "offline\n",
    });
    const runFile = vi.fn(async () => {
      throw failure;
    });
    const tool = createBacktraderCore5DevReadinessTool({ runFile });

    const result = await tool.execute("call-1", { report: "ny-preopen" });

    expect(result.details).toMatchObject({
      ok: false,
      report: "ny-preopen",
      script: BACKTRADER_CORE5_DEV_READINESS_SCRIPT,
      code: "EFAIL",
      signal: "SIGTERM",
      killed: true,
      error: "readiness failed",
      stdout: { ready: false },
      stderr: "offline",
    });
  });
});
