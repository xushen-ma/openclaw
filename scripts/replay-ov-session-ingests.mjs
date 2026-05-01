#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_START = "2026-04-28";
const DEFAULT_END = "2026-04-30";
const MODES = new Set(["full", "summarize", "summarize-short"]);

function homePath(...parts) {
  return path.join(os.homedir(), ...parts);
}

function parseArgs(argv) {
  const out = {
    start: DEFAULT_START,
    end: DEFAULT_END,
    statsLog: homePath(".openclaw", "stats", "ov-stats.jsonl"),
    cacheRoot: homePath(".openclaw", "memory", "openviking", ".session-text-cache"),
    dataRoot: homePath(".openclaw", "memory", "openviking"),
    openvikingQuery: process.env.OPENVIKING_QUERY_SH || homePath(".openclaw", "workspace", "scripts", "ov", "openviking_query.sh"),
    agents: [],
    apply: false,
    dryRun: false,
    force: false,
    includeMtimeCandidates: false,
    max: Number.POSITIVE_INFINITY,
    retries: 1,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) {
        throw new Error(`Missing value for ${arg}`);
      }
      return argv[i];
    };

    if (arg === "--apply") {
      out.apply = true;
    } else if (arg === "--dry-run") {
      out.dryRun = true;
    } else if (arg === "--force") {
      out.force = true;
    } else if (arg === "--include-mtime-candidates") {
      out.includeMtimeCandidates = true;
    } else if (arg === "--start") {
      out.start = next();
    } else if (arg === "--end") {
      out.end = next();
    } else if (arg === "--stats-log") {
      out.statsLog = next();
    } else if (arg === "--cache-root") {
      out.cacheRoot = next();
    } else if (arg === "--data-root") {
      out.dataRoot = next();
    } else if (arg === "--openviking-query") {
      out.openvikingQuery = next();
    } else if (arg === "--agent") {
      out.agents.push(...next().split(",").map((x) => x.trim()).filter(Boolean));
    } else if (arg === "--max") {
      out.max = Math.max(0, Number(next()));
    } else if (arg === "--retries") {
      out.retries = Math.max(0, Number(next()));
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return { ...out, dryRun: out.dryRun || !out.apply };
}

function printUsage() {
  console.log(`Usage: node scripts/replay-ov-session-ingests.mjs [options]

Replay Apr 28-30 OpenViking session ingests from existing session text cache.
Dry-run is the default; pass --apply to call OpenViking.

Options:
  --dry-run                 Preview only (default)
  --apply                   Run non-destructive ingest for missing candidates
  --start YYYY-MM-DD        Start date, inclusive (default ${DEFAULT_START})
  --end YYYY-MM-DD          End date, inclusive (default ${DEFAULT_END})
  --stats-log PATH          OV stats JSONL, malformed rows tolerated
  --cache-root PATH         Session text cache root
  --data-root PATH          OpenViking data root for .ingested state
  --agent AGENT[,AGENT]     Limit to one or more agents
  --max N                   Maximum candidates to process
  --retries N               Retries per ingest command (default 1)
  --force                   Ignore .ingested state
  --include-mtime-candidates
                            Also replay all cache files modified in the date window
                            (default is stats-row hinted candidates only)
`);
}

function dateRange(start, end) {
  return {
    startMs: Date.parse(`${start}T00:00:00.000Z`),
    endMs: Date.parse(`${end}T23:59:59.999Z`),
  };
}

function timestampMs(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function inRange(value, range) {
  const ms = timestampMs(value);
  return ms !== null && ms >= range.startMs && ms <= range.endMs;
}

function salvageMalformedStatsRow(raw) {
  const fields = {};
  for (const match of raw.matchAll(/"([^"\\]+)"\s*:\s*"((?:\\.|[^"\\])*)"/g)) {
    fields[match[1]] = match[2].replace(/\\"/g, '"').replace(/\\n/g, "\n");
  }
  for (const match of raw.matchAll(/"([^"\\]+)"\s*:\s*(-?\d+(?:\.\d+)?|true|false|null)/g)) {
    const value = match[2];
    fields[match[1]] =
      value === "true" ? true : value === "false" ? false : value === "null" ? null : Number(value);
  }
  if (Object.keys(fields).length === 0) {
    return null;
  }
  return { value: fields, malformed: true, raw };
}

function parseStatsRows(text) {
  const rows = [];
  let pending = "";
  let braceDepth = 0;

  const flushPending = () => {
    const raw = pending.trim();
    pending = "";
    braceDepth = 0;
    if (!raw) {
      return;
    }
    try {
      rows.push({ value: JSON.parse(raw), malformed: false, raw });
      return;
    } catch {
      const salvaged = salvageMalformedStatsRow(raw);
      if (salvaged) {
        rows.push(salvaged);
      }
    }
  };

  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    if (pending && line.trimStart().startsWith("{") && braceDepth <= 0) {
      flushPending();
    }
    pending = pending ? `${pending}\n${line}` : line;
    braceDepth += (line.match(/{/g) || []).length;
    braceDepth -= (line.match(/}/g) || []).length;
    if (braceDepth <= 0) {
      flushPending();
    }
  }
  flushPending();
  return rows;
}

function rowSuggestsBadIngest(row, range) {
  const value = row.value || {};
  const ts = value.ts || value.timestamp || value.time;
  if (ts && !inRange(String(ts), range)) {
    return false;
  }
  const layer = String(value.layer || value.op || value.event || "");
  const hasIngestSignal = /ingest|session/i.test(layer) || value.file || value.sessionId || value.uuid;
  const failed = Number(value.failed || 0) > 0 || value.status === "error" || value.error;
  return row.malformed || (hasIngestSignal && failed);
}

function parseCacheName(fileName) {
  const match = fileName.match(/^(.+)\.(full|summarize|summarize-short)\.txt$/);
  if (!match) {
    return null;
  }
  return { sessionId: match[1], mode: match[2], stateKey: `${match[1]}:${match[2]}` };
}

function candidateHintFromRow(row) {
  const value = row.value || {};
  const agent = String(value.agent || value.agentId || "").trim();
  const explicitPath = String(value.file || value.path || value.cacheFile || value.uri || "").trim();
  const parsed = explicitPath ? parseCacheName(path.basename(explicitPath)) : null;
  const sessionId = String(value.sessionId || value.uuid || parsed?.sessionId || "").trim();
  const explicitMode = String(value.mode || "").trim();
  const mode = MODES.has(explicitMode) ? explicitMode : parsed?.mode || "";
  return {
    agent,
    sessionId,
    mode: MODES.has(mode) ? mode : "",
    file: explicitPath,
  };
}

function hintHasIdentity(hint) {
  return Boolean(hint.sessionId || hint.file);
}

async function listAgentCacheFiles(cacheRoot, agent) {
  const dir = path.join(cacheRoot, agent);
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    const parsed = parseCacheName(entry.name);
    if (!parsed) {
      continue;
    }
    const file = path.join(dir, entry.name);
    const stat = await fs.stat(file);
    files.push({ agent, file, mtimeMs: stat.mtimeMs, ...parsed });
  }
  return files;
}

async function discoverReplayCandidates(options) {
  const range = dateRange(options.start, options.end);
  const statsText = existsSync(options.statsLog) ? await fs.readFile(options.statsLog, "utf8") : "";
  const rows = parseStatsRows(statsText).filter((row) => rowSuggestsBadIngest(row, range));
  const hints = rows.map(candidateHintFromRow);
  const agents = new Set(options.agents);
  for (const hint of hints) {
    if (hint.agent) {
      agents.add(hint.agent);
    }
  }
  if (agents.size === 0) {
    try {
      for (const entry of await fs.readdir(options.cacheRoot, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          agents.add(entry.name);
        }
      }
    } catch {
      return { rows, candidates: [] };
    }
  }

  const candidates = [];
  for (const agent of agents) {
    const files = await listAgentCacheFiles(options.cacheRoot, agent);
    const agentHints = hints.filter((hint) => (!hint.agent || hint.agent === agent) && hintHasIdentity(hint));
    for (const file of files) {
      const hinted = agentHints.some((hint) => {
        const idMatches = !hint.sessionId || hint.sessionId === file.sessionId;
        const modeMatches = !hint.mode || hint.mode === file.mode;
        const fileMatches = !hint.file || path.resolve(hint.file) === path.resolve(file.file);
        return idMatches && modeMatches && fileMatches;
      });
      const mtimeMatches =
        options.includeMtimeCandidates && file.mtimeMs >= range.startMs && file.mtimeMs <= range.endMs;
      if (hinted || mtimeMatches) {
        candidates.push(file);
      }
    }
  }

  candidates.sort((a, b) => a.agent.localeCompare(b.agent) || a.sessionId.localeCompare(b.sessionId));
  return { rows, candidates };
}

async function stateContains(dataRoot, agent, stateKey) {
  const statePath = path.join(dataRoot, agent, ".ingested");
  try {
    const text = await fs.readFile(statePath, "utf8");
    return text.split(/\r?\n/).includes(stateKey);
  } catch {
    return false;
  }
}

async function appendState(dataRoot, agent, stateKey) {
  const storeDir = path.join(dataRoot, agent);
  await fs.mkdir(storeDir, { recursive: true });
  const statePath = path.join(storeDir, ".ingested");
  if (await stateContains(dataRoot, agent, stateKey)) {
    return;
  }
  await fs.appendFile(statePath, `${stateKey}\n`, "utf8");
}

function isDuplicateFinalizeError(text) {
  return /file exists|already exists|directory exists|destination.*exists|errno 17|os error 17|FileExistsError/i.test(
    String(text || ""),
  );
}

function runCommand(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => resolve({ code: 127, stdout, stderr: `${stderr}${error.message}` }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

async function replayCandidate(candidate, options) {
  const alreadyIngested = await stateContains(options.dataRoot, candidate.agent, candidate.stateKey);
  if (alreadyIngested && !options.force) {
    return { status: "skipped", reason: "already-ingested", candidate };
  }
  if (options.dryRun) {
    return { status: "dry-run", candidate };
  }

  const args = [
    "--agent",
    candidate.agent,
    "--ingest",
    candidate.file,
    `replay session ${candidate.sessionId} ${candidate.mode} ${options.start}..${options.end}`,
  ];
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    const result = await runCommand(options.openvikingQuery, args);
    if (result.code === 0) {
      await appendState(options.dataRoot, candidate.agent, candidate.stateKey);
      return { status: "ingested", candidate, attempt };
    }
    const combined = `${result.stdout}\n${result.stderr}`;
    if (isDuplicateFinalizeError(combined)) {
      await appendState(options.dataRoot, candidate.agent, candidate.stateKey);
      return { status: "duplicate-finalize", candidate, attempt };
    }
    if (attempt >= options.retries) {
      return { status: "failed", candidate, error: combined.slice(0, 1000), attempt };
    }
  }
  return { status: "failed", candidate, error: "unreachable replay state", attempt: options.retries };
}

async function run(argv) {
  const options = parseArgs(argv);
  const { rows, candidates } = await discoverReplayCandidates(options);
  const selected = [];
  for (const candidate of candidates) {
    if (selected.length >= options.max) {
      break;
    }
    selected.push(candidate);
  }

  const results = [];
  for (const candidate of selected) {
    const result = await replayCandidate(candidate, options);
    results.push(result);
    console.log(JSON.stringify({ ...result, candidate: result.candidate }));
  }

  const summary = {
    dryRun: options.dryRun,
    statsRowsUsed: rows.length,
    candidates: candidates.length,
    processed: results.length,
    ingested: results.filter((x) => x.status === "ingested").length,
    duplicateFinalize: results.filter((x) => x.status === "duplicate-finalize").length,
    skipped: results.filter((x) => x.status === "skipped").length,
    failed: results.filter((x) => x.status === "failed").length,
  };
  console.log(JSON.stringify({ summary }));
  return summary.failed > 0 ? 1 : 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  run(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      console.error(JSON.stringify({ status: "error", error: error instanceof Error ? error.message : String(error) }));
      process.exitCode = 1;
    },
  );
}

export {
  candidateHintFromRow,
  discoverReplayCandidates,
  isDuplicateFinalizeError,
  parseArgs,
  parseStatsRows,
  replayCandidate,
  run,
};
