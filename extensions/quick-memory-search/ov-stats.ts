import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";

const OV_STATS_DEBUG = process.env.OV_STATS_DEBUG === "1";

export type OvStatsLayer = "fast-pass" | "fast-pass-shared" | "session-history";
export type OvFailureClass = "token" | "rate" | "resource" | "http" | "backend";

export type OvStatsEntry = {
  agent: string;
  op: string;
  query: string;
  mode: string;
  layer: OvStatsLayer;
  latencyMs: number;
  resultCount: number;
  hit: boolean;
  uri?: string;
  routing?: "per-agent" | "legacy" | "local";
  status?: number;
  failureClass?: OvFailureClass;
  failure?: string;
};

export function resolveStatsLogPath(): string {
  const fromEnv = process.env.OV_STATS_LOG_PATH?.trim();
  if (fromEnv) return fromEnv;
  return `${homedir()}/.openclaw/stats/ov-stats.jsonl`;
}

const tokenFailurePatterns = [
  /insufficient[_\s-]*quota/i,
  /quota/i,
  /token[_\s-]*limit/i,
  /billing/i,
  /insufficient credits/i,
];

const rateFailurePatterns = [/rate[_\s-]?limit/i, /too many requests/i, /qps/i, /throttle/i];

const resourceFailurePatterns = [
  /resource(\s*|-)limit/i,
  /resource exhausted/i,
  /out of memory/i,
  /memory(?:\s*)full/i,
  /disk/i,
  /readonly/i,
];

export function classifyOvFailure(params: { status?: number; reason?: string }): OvFailureClass {
  const normalized = (params.reason ?? "").toLowerCase();
  if (params.status === 429 || /\b429\b/.test(normalized)) return "rate";
  if (tokenFailurePatterns.some((pattern) => pattern.test(normalized))) return "token";
  if (rateFailurePatterns.some((pattern) => pattern.test(normalized))) return "rate";
  if (resourceFailurePatterns.some((pattern) => pattern.test(normalized))) return "resource";
  if (params.status !== undefined) return "http";
  return "backend";
}

export async function writeOvStats(entry: OvStatsEntry): Promise<void> {
  const logPath = resolveStatsLogPath();
  if (OV_STATS_DEBUG) {
    console.error(
      `[ov-stats] pid=${process.pid} preparing write path=${logPath} op=${entry.op} layer=${entry.layer} routing=${entry.routing ?? ""}`,
    );
  }
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    agent: entry.agent,
    op: entry.op,
    uri: entry.uri || "",
    query: entry.query,
    latency_ms: Math.max(0, Math.round(entry.latencyMs)),
    results: entry.resultCount,
    hit: Boolean(entry.hit),
    mode: entry.mode,
    layer: entry.layer,
    routing: entry.routing,
    status: entry.status,
    failure_class: entry.failureClass,
    failure: entry.failure,
  });

  try {
    await mkdir(dirname(logPath), { recursive: true });
    await appendFile(logPath, `${line}\n`, "utf8");
    if (OV_STATS_DEBUG) {
      console.error(`[ov-stats] pid=${process.pid} write ok path=${logPath}`);
    }
  } catch (err) {
    if (OV_STATS_DEBUG) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[ov-stats] pid=${process.pid} write failed path=${logPath} error=${message}`);
    }
    throw err;
  }
}
