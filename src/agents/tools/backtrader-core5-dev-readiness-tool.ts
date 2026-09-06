/**
 * Fixed Backtrader Core5 readiness boundary.
 *
 * Exposes one read-only project executable with a closed report enum and no
 * caller-controlled command, path, argv, environment, or trading controls.
 */
import { execFile, type ExecFileOptionsWithStringEncoding } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { Type } from "typebox";
import { optionalStringEnum } from "../schema/string-enum.js";
import { BACKTRADER_CORE5_DEV_READINESS_TOOL_NAME } from "./backtrader-core5-dev-readiness-tool-name.js";
import {
  jsonResult,
  readNumberParam,
  readToolStringParam,
  ToolInputError,
  type AnyAgentTool,
} from "./common.js";

const execFileAsync = promisify(execFile);

export { BACKTRADER_CORE5_DEV_READINESS_TOOL_NAME };
export const BACKTRADER_CORE5_DEV_READINESS_SCRIPT =
  "/Users/openclaw/.openclaw/workspace-uri/projects/backtrader-dev/scripts/core5_dev_readiness.py";

const BACKTRADER_CORE5_DEV_READINESS_CWD = path.dirname(
  path.dirname(BACKTRADER_CORE5_DEV_READINESS_SCRIPT),
);
const BACKTRADER_CORE5_REPORTS = ["status", "ny-preopen", "daily-paper"] as const;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 10 * 60_000;
const MAX_BUFFER_BYTES = 2 * 1024 * 1024;

const BacktraderCore5DevReadinessSchema = Type.Object(
  {
    report: optionalStringEnum(BACKTRADER_CORE5_REPORTS),
    timeoutMs: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_TIMEOUT_MS })),
  },
  { additionalProperties: false },
);

type RunFileResult = { stdout: string; stderr: string };
type RunFile = (
  file: string,
  args: readonly string[],
  options: ExecFileOptionsWithStringEncoding,
) => Promise<RunFileResult>;

export type BacktraderCore5DevReadinessToolDependencies = {
  runFile?: RunFile;
};

const defaultRunFile: RunFile = async (file, args, options) =>
  (await execFileAsync(file, [...args], options)) as RunFileResult;

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

/** Creates the sole read-only Backtrader Core5 readiness tool. */
export function createBacktraderCore5DevReadinessTool(
  dependencies: BacktraderCore5DevReadinessToolDependencies = {},
): AnyAgentTool {
  const runFile = dependencies.runFile ?? defaultRunFile;
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
      const report = readToolStringParam(params, "report") ?? "status";
      if (!BACKTRADER_CORE5_REPORTS.includes(report as (typeof BACKTRADER_CORE5_REPORTS)[number])) {
        throw new ToolInputError("report must be status, ny-preopen, or daily-paper");
      }
      const timeoutMs = resolveTimeoutMs(
        readNumberParam(params, "timeoutMs", { integer: true, label: "timeoutMs" }),
      );

      const startedAt = Date.now();
      try {
        const result = await runFile(
          BACKTRADER_CORE5_DEV_READINESS_SCRIPT,
          ["--report", report, "--json"],
          {
            cwd: BACKTRADER_CORE5_DEV_READINESS_CWD,
            encoding: "utf8",
            timeout: timeoutMs,
            signal,
            windowsHide: true,
            shell: false,
            maxBuffer: MAX_BUFFER_BYTES,
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
      } catch (cause) {
        const error = cause as NodeJS.ErrnoException & {
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
