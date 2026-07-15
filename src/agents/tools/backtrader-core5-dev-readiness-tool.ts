import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { Type } from "typebox";
import {
  jsonResult,
  readNumberParam,
  readStringParam,
  ToolInputError,
  type AnyAgentTool,
} from "./common.js";

const execFileAsync = promisify(execFile);

export const BACKTRADER_CORE5_DEV_READINESS_TOOL_NAME = "backtrader_core5_dev_readiness";
export const BACKTRADER_CORE5_DEV_READINESS_SCRIPT =
  "/Users/openclaw/.openclaw/workspace-uri/projects/backtrader-dev/scripts/core5_dev_readiness.py";
const BACKTRADER_CORE5_DEV_READINESS_CWD = path.dirname(
  path.dirname(BACKTRADER_CORE5_DEV_READINESS_SCRIPT),
);
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 10 * 60_000;

const BacktraderCore5DevReadinessSchema = Type.Object({
  report: Type.Optional(
    Type.Union([Type.Literal("ny-preopen"), Type.Literal("daily-paper"), Type.Literal("status")]),
  ),
  timeoutMs: Type.Optional(Type.Number()),
});

function resolveTimeoutMs(raw: number | undefined): number {
  if (raw === undefined) {
    return DEFAULT_TIMEOUT_MS;
  }
  if (!Number.isFinite(raw) || raw <= 0) {
    throw new ToolInputError("timeoutMs must be a positive finite number");
  }
  return Math.min(Math.trunc(raw), MAX_TIMEOUT_MS);
}

function parseStdout(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

export function createBacktraderCore5DevReadinessTool(): AnyAgentTool {
  return {
    name: BACKTRADER_CORE5_DEV_READINESS_TOOL_NAME,
    label: BACKTRADER_CORE5_DEV_READINESS_TOOL_NAME,
    description:
      "Run the single read-only Backtrader Core5 dev readiness executable. This tool can only execute /Users/openclaw/.openclaw/workspace-uri/projects/backtrader-dev/scripts/core5_dev_readiness.py with fixed JSON/report arguments; it cannot run shell commands, submit orders, arm trading, or read arbitrary files.",
    parameters: BacktraderCore5DevReadinessSchema,
    displaySummary: "Run Backtrader Core5 dev readiness script.",
    async execute(_toolCallId, rawParams, signal) {
      const params =
        rawParams && typeof rawParams === "object" ? (rawParams as Record<string, unknown>) : {};
      const report = readStringParam(params, "report") ?? "status";
      if (!["ny-preopen", "daily-paper", "status"].includes(report)) {
        throw new ToolInputError("report must be ny-preopen, daily-paper, or status");
      }
      const timeoutMs = resolveTimeoutMs(
        readNumberParam(params, "timeoutMs", { integer: true, label: "timeoutMs" }),
      );

      const startedAt = Date.now();
      try {
        const result = await execFileAsync(
          BACKTRADER_CORE5_DEV_READINESS_SCRIPT,
          ["--report", report, "--json"],
          {
            cwd: BACKTRADER_CORE5_DEV_READINESS_CWD,
            timeout: timeoutMs,
            signal,
            windowsHide: true,
            maxBuffer: 2 * 1024 * 1024,
            env: {
              ...process.env,
              OPENCLAW_BACKTRADER_CORE5_DEV_READINESS: "1",
              OPENCLAW_BACKTRADER_CORE5_READ_ONLY: "1",
              OPENCLAW_BACKTRADER_CORE5_NO_SUBMIT: "1",
              OPENCLAW_BACKTRADER_CORE5_NO_ARM: "1",
            },
          },
        );
        return jsonResult({
          ok: true,
          report,
          script: BACKTRADER_CORE5_DEV_READINESS_SCRIPT,
          durationMs: Date.now() - startedAt,
          stdout: parseStdout(result.stdout),
          stderr: result.stderr.trim() || undefined,
        });
      } catch (err) {
        const error = err as NodeJS.ErrnoException & {
          stdout?: string;
          stderr?: string;
          code?: unknown;
          signal?: unknown;
          killed?: boolean;
        };
        return jsonResult({
          ok: false,
          report,
          script: BACKTRADER_CORE5_DEV_READINESS_SCRIPT,
          durationMs: Date.now() - startedAt,
          code: error.code,
          signal: error.signal,
          killed: error.killed,
          error: error.message,
          stdout: parseStdout(error.stdout ?? ""),
          stderr: error.stderr?.trim() || undefined,
        });
      }
    },
  };
}
