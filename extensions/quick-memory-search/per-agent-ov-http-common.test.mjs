import assert from "node:assert/strict";
import {
  resolveAgentAndScope,
  resolveStorePath,
  normalizeAgentId,
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

console.log("per-agent-ov-http-common tests passed");
