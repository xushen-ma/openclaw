import assert from "node:assert/strict";
import {
  resolveAgentAndScope,
  resolveStorePath,
  normalizeAgentId,
  toOpenVikingResult,
  truncateEmbeddingInput,
  createOpenVikingSearchScript,
} from "./per-agent-ov-http-common.mjs";

assert.equal(normalizeAgentId("ben"), "ben");
assert.equal(normalizeAgentId("../ben"), "ben");
assert.equal(normalizeAgentId(""), "main");
assert.equal(normalizeAgentId(".."), "main");
assert.equal(normalizeAgentId(".../../"), "main");

{
  const out = resolveAgentAndScope({
    pathname: "/api/v1/search/find",
    query: new URLSearchParams(),
    headers: { "x-openclaw-agent-id": "kiki" },
  });
  assert.equal(out.scope, "memory");
  assert.equal(out.agentId, "kiki");
}

{
  const out = resolveAgentAndScope({
    pathname: "/api/v1/search/session-find",
    query: new URLSearchParams("agentId=ben"),
    headers: {},
  });
  assert.equal(out.scope, "sessions");
  assert.equal(out.agentId, "ben");
}

{
  const out = resolveAgentAndScope({
    pathname: "/agents/main/api/v1/search/find",
    query: new URLSearchParams(),
    headers: {},
  });
  assert.equal(out.scope, "memory");
  assert.equal(out.agentId, "main");
}

assert.equal(
  resolveStorePath({ memoryRoot: "/tmp/ov", agentId: "ben", scope: "memory" }),
  "/tmp/ov/ben",
);
assert.equal(
  resolveStorePath({ memoryRoot: "/tmp/ov", agentId: "ben", scope: "sessions" }),
  "/tmp/ov/ben-sessions",
);

{
  const out = toOpenVikingResult(
    {
      totalHits: 1,
      results: [{ uri: "viking://resources/main/one", score: 0.5, text: "mapped" }],
    },
    5,
  );
  assert.equal(out.result.total, 1);
  assert.equal(out.result.resources[0].abstract, "mapped");
}

{
  const out = truncateEmbeddingInput(`${"x".repeat(9000)} keep-tail`);
  assert.equal(out.truncated, true);
  assert.ok(out.text.length <= 8192);
  assert.ok(out.text.includes("keep-tail"));
}

assert.equal(createOpenVikingSearchScript().includes("127.0.0.1:8087"), false);
assert.ok(createOpenVikingSearchScript().includes("SyncOpenViking(path=store)"));

console.log("per-agent-ov-http-common tests passed");
