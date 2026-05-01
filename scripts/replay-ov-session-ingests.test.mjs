import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  discoverReplayCandidates,
  isDuplicateFinalizeError,
  parseStatsRows,
  replayCandidate,
} from "./replay-ov-session-ingests.mjs";

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ov-replay-test-"));
try {
  const cacheRoot = path.join(tmp, "cache");
  const dataRoot = path.join(tmp, "data");
  const statsLog = path.join(tmp, "ov-stats.jsonl");
  const agentCache = path.join(cacheRoot, "main");
  await fs.mkdir(agentCache, { recursive: true });
  const cacheFile = path.join(agentCache, "sess-1.full.txt");
  const oldCacheFile = path.join(agentCache, "old-sess.full.txt");
  await fs.writeFile(cacheFile, "Session: sess-1\n---\nhello", "utf8");
  await fs.writeFile(oldCacheFile, "Session: old-sess\n---\nolder", "utf8");
  const apr29 = new Date("2026-04-29T12:00:00Z");
  const mar29 = new Date("2026-03-29T12:00:00Z");
  await fs.utimes(cacheFile, apr29, apr29);
  await fs.utimes(oldCacheFile, mar29, mar29);

  const statsText = [
    JSON.stringify({
      ts: "2026-04-29T12:01:00Z",
      agent: "main",
      uri: cacheFile,
      layer: "session-ingest",
      status: "error",
      error: 'bad "quote"\\n{"nested":true}',
    }),
    JSON.stringify({
      ts: "2026-04-29T12:01:30Z",
      agent: "main",
      layer: "ingest-failed",
      status: "error",
      error: "agent-only row should not replay every historical cache file",
    }),
    '{"ts":"2026-04-29T12:02:00Z","agent":"main","file":"' +
      cacheFile +
      '","layer":"session-ingest","status":"error","error":"bad "quote',
    '{"nested":true}"}',
  ].join("\n");
  await fs.writeFile(statsLog, statsText, "utf8");

  const rows = parseStatsRows(statsText);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].malformed, false);
  assert.equal(rows[1].malformed, false);
  assert.equal(rows[2].malformed, true);
  assert.equal(rows[2].value.agent, "main");

  const discovered = await discoverReplayCandidates({
    start: "2026-04-28",
    end: "2026-04-30",
    statsLog,
    cacheRoot,
    dataRoot,
    agents: [],
    includeMtimeCandidates: false,
  });
  assert.equal(discovered.candidates.length, 1);
  assert.equal(discovered.candidates[0].stateKey, "sess-1:full");

  assert.equal(isDuplicateFinalizeError("FileExistsError: directory already exists"), true);
  assert.equal(isDuplicateFinalizeError("regular embedding timeout"), false);

  const fakeOv = path.join(tmp, "fake-ov.sh");
  await fs.writeFile(fakeOv, "#!/usr/bin/env bash\necho 'FileExistsError: directory already exists' >&2\nexit 1\n", "utf8");
  await fs.chmod(fakeOv, 0o755);

  const replayed = await replayCandidate(discovered.candidates[0], {
    dryRun: false,
    force: false,
    dataRoot,
    openvikingQuery: fakeOv,
    start: "2026-04-28",
    end: "2026-04-30",
    retries: 2,
  });
  assert.equal(replayed.status, "duplicate-finalize");

  const state = await fs.readFile(path.join(dataRoot, "main", ".ingested"), "utf8");
  assert.equal(state.trim(), "sess-1:full");
} finally {
  await fs.rm(tmp, { recursive: true, force: true });
}

console.log("replay-ov-session-ingests tests passed");
