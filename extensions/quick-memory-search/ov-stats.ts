import { appendFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";

export type OvStatsLayer = "fast-pass" | "fast-pass-shared" | "session-history";

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
};

function resolveStatsLogPath(): string {
  const fromEnv = process.env.OV_STATS_LOG_PATH?.trim();
  if (fromEnv) return fromEnv;
  return `${homedir()}/.openclaw/stats/ov-stats.jsonl`;
}

export async function writeOvStats(entry: OvStatsEntry): Promise<void> {
  const logPath = resolveStatsLogPath();
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
  });

  await mkdir(dirname(logPath), { recursive: true });
  await appendFile(logPath, `${line}\n`, "utf8");
}
